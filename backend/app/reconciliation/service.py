import hashlib
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, text

from app.audit import service as audit
from app.branches.models import Branch
from app.branches.scope import active_branch_id
from app.idempotency import service as idempotency
from app.orders.models import Order, Payment
from app.reconciliation.models import ImportBatch, ReconciliationMatch, SettlementEntry, now
from app.reconciliation.parser import preview
from app.reconciliation.schemas import BatchResponse, EntryResponse, MatchResponse
from app.shared.exceptions import bad_request, conflict, not_found

ZERO = Decimal("0.00")


def _lock(db, tenant_id, resource):
    # Cross-process serialization without granting UPDATE on immutable payment ledgers.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:scope, 0))"),
        {"scope": f"kova-reconciliation:{tenant_id}:{resource}"},
    )


def _claim(db, tenant_id, key, scope, body):
    if not key or len(key) > 255 or not key.strip():
        raise bad_request("Idempotency-Key debe contener entre 1 y 255 caracteres")
    fingerprint = hashlib.sha256(
        f"reconciliation:{scope}:{body.model_dump_json()}".encode()
    ).hexdigest()
    return fingerprint, idempotency.claim(
        db, tenant_id=tenant_id, key=key, request_hash=fingerprint
    )


def _store(db, tenant_id, key, fingerprint, result):
    idempotency.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=fingerprint,
        response_status=200,
        response_body=result,
    )
    db.commit()
    return result


def commit_import(db, tenant_id, user_id, body, key):
    fingerprint, replay = _claim(db, tenant_id, key, "import", body)
    if replay:
        return replay.response_body
    parsed = preview(body.csv_content)
    if parsed.errors or parsed.content_sha256 != body.content_sha256:
        raise bad_request("Corrige las filas y vuelve a revisar el CSV antes de importar")
    selected = {row.row_number: row for row in parsed.rows}
    if any(number not in selected for number in body.selected_rows):
        raise bad_request("La selección contiene filas que no existen")
    rows = [selected[number] for number in sorted(body.selected_rows)]
    checksum = hashlib.sha256("|".join(row.row_fingerprint for row in rows).encode()).hexdigest()
    branch_id = active_branch_id(db, tenant_id)
    # Serialize duplicate imports including overlapping files, without trusting file names.
    db.query(Branch).filter(
        Branch.tenant_id == tenant_id, Branch.id == branch_id
    ).with_for_update().one()
    batch = (
        db.query(ImportBatch)
        .filter(
            ImportBatch.tenant_id == tenant_id,
            ImportBatch.branch_id == branch_id,
            ImportBatch.content_sha256 == checksum,
        )
        .first()
    )
    if batch:
        return _store(
            db,
            tenant_id,
            key,
            fingerprint,
            BatchResponse.model_validate(batch).model_dump(mode="json"),
        )
    existing = (
        db.query(SettlementEntry.id)
        .filter(
            SettlementEntry.tenant_id == tenant_id,
            SettlementEntry.branch_id == branch_id,
            SettlementEntry.row_fingerprint.in_([row.row_fingerprint for row in rows]),
        )
        .first()
    )
    if existing:
        raise conflict("Hay liquidaciones ya importadas. Exclúyelas de la selección")
    batch = ImportBatch(
        tenant_id=tenant_id,
        branch_id=branch_id,
        content_sha256=checksum,
        row_count=len(rows),
        created_by_user_id=user_id,
    )
    db.add(batch)
    db.flush()
    for row in rows:
        db.add(
            SettlementEntry(
                tenant_id=tenant_id,
                branch_id=branch_id,
                batch_id=batch.id,
                **row.model_dump(exclude={"row_number"}),
            )
        )
    db.flush()
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="reconciliation.batch.committed",
        resource_type="reconciliation_batch",
        resource_id=batch.id,
        changes={"row_count": len(rows), "parser_version": 1},
    )
    return _store(
        db, tenant_id, key, fingerprint, BatchResponse.model_validate(batch).model_dump(mode="json")
    )


def _entry(db, tenant_id, entry_id, *, lock=False):
    if lock:
        _lock(db, tenant_id, f"entry:{entry_id}")
    query = db.query(SettlementEntry).filter(
        SettlementEntry.tenant_id == tenant_id,
        SettlementEntry.id == entry_id,
        SettlementEntry.branch_id == active_branch_id(db, tenant_id),
    )
    row = query.first()
    if row is None:
        raise not_found("Liquidación no encontrada")
    return row


def _allocated(db, tenant_id, *, entry_id=None, payment_id=None):
    query = db.query(func.coalesce(func.sum(ReconciliationMatch.matched_amount), ZERO)).filter(
        ReconciliationMatch.tenant_id == tenant_id, ReconciliationMatch.status == "confirmed"
    )
    if entry_id:
        query = query.filter(ReconciliationMatch.settlement_entry_id == entry_id)
    if payment_id:
        query = query.filter(ReconciliationMatch.payment_id == payment_id)
    return query.scalar() or ZERO


def serialize_entry(db, entry):
    matches = (
        db.query(ReconciliationMatch)
        .filter(
            ReconciliationMatch.tenant_id == entry.tenant_id,
            ReconciliationMatch.settlement_entry_id == entry.id,
            ReconciliationMatch.branch_id == entry.branch_id,
        )
        .order_by(ReconciliationMatch.created_at, ReconciliationMatch.id)
        .all()
    )
    total = sum((row.matched_amount for row in matches if row.status == "confirmed"), ZERO)
    status = (
        "matched"
        if total == entry.net_amount
        else "partially_matched"
        if total > 0
        else "unmatched"
    )
    fields = {
        name: getattr(entry, name)
        for name in EntryResponse.model_fields
        if name not in {"status", "matched_amount", "remaining_amount", "matches"}
    }
    return EntryResponse(
        **fields,
        status=status,
        matched_amount=total,
        remaining_amount=entry.net_amount - total,
        matches=[MatchResponse.model_validate(row) for row in matches],
    ).model_dump(mode="json")


def list_entries(db, tenant_id, *, limit=50, offset=0):
    rows = (
        db.query(SettlementEntry)
        .filter(
            SettlementEntry.tenant_id == tenant_id,
            SettlementEntry.branch_id == active_branch_id(db, tenant_id),
        )
        .order_by(SettlementEntry.settled_at.desc(), SettlementEntry.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    return {
        "entries": [serialize_entry(db, entry) for entry in rows[:limit]],
        "has_more": len(rows) > limit,
    }


def suggest(db, tenant_id, user_id, entry_id, body, key):
    fingerprint, replay = _claim(db, tenant_id, key, f"suggest:{entry_id}", body)
    if replay:
        return replay.response_body
    entry = _entry(db, tenant_id, entry_id, lock=True)
    remaining = entry.net_amount - _allocated(db, tenant_id, entry_id=entry.id)
    if remaining > 0:
        candidates = (
            db.query(Payment, Order)
            .join(Order, Order.id == Payment.order_id)
            .filter(
                Payment.tenant_id == tenant_id,
                Order.tenant_id == tenant_id,
                Order.branch_id == entry.branch_id,
                Order.status == "completed",
                Payment.method == entry.payment_method,
                func.coalesce(Order.occurred_at, Order.created_at)
                >= entry.settled_at - timedelta(days=7),
                func.coalesce(Order.occurred_at, Order.created_at)
                <= entry.settled_at + timedelta(days=1),
                Payment.amount_amount > 0,
            )
            .order_by(Order.created_at.desc(), Payment.id)
            .limit(20)
            .all()
        )
        for payment, order in candidates:
            match = (
                db.query(ReconciliationMatch)
                .filter(
                    ReconciliationMatch.tenant_id == tenant_id,
                    ReconciliationMatch.settlement_entry_id == entry.id,
                    ReconciliationMatch.payment_id == payment.id,
                )
                .first()
            )
            if match is not None and match.status != "suggested":
                continue
            available = payment.amount_amount - _allocated(db, tenant_id, payment_id=payment.id)
            amount = min(remaining, available)
            if amount <= 0:
                continue
            reasons = [
                "Mismo método de pago",
                "Venta en ventana de liquidación (7 días antes a 1 después)",
            ]
            if payment.amount_amount == entry.gross_amount:
                reasons.append("El pago coincide con el importe bruto")
            else:
                reasons.append("Asignación parcial; revisa el importe antes de confirmar")
            suffix = entry.external_reference_masked.lstrip("*")
            if suffix and payment.reference and payment.reference.endswith(suffix):
                reasons.append("Terminación de referencia coincidente")
            if match is None:
                match = ReconciliationMatch(
                    tenant_id=tenant_id,
                    branch_id=entry.branch_id,
                    settlement_entry_id=entry.id,
                    payment_id=payment.id,
                    order_id=order.id,
                    matched_amount=amount,
                    reasons=reasons,
                )
                db.add(match)
            elif match.matched_amount != amount or match.reasons != reasons:
                match.matched_amount = amount
                match.reasons = reasons
                match.version += 1
                match.updated_at = now()
        db.flush()
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="reconciliation.matches.suggested",
        resource_type="settlement_entry",
        resource_id=entry.id,
        changes={"automatic_confirmation": False},
    )
    return _store(db, tenant_id, key, fingerprint, serialize_entry(db, entry))


def act_on_match(db, tenant_id, user_id, entry_id, match_id, action, body, key):
    fingerprint, replay = _claim(db, tenant_id, key, f"{action}:{entry_id}:{match_id}", body)
    if replay:
        return replay.response_body
    entry = _entry(db, tenant_id, entry_id, lock=True)
    match = (
        db.query(ReconciliationMatch)
        .filter(
            ReconciliationMatch.tenant_id == tenant_id,
            ReconciliationMatch.id == match_id,
            ReconciliationMatch.settlement_entry_id == entry.id,
            ReconciliationMatch.branch_id == entry.branch_id,
        )
        .with_for_update()
        .first()
    )
    if match is None:
        raise not_found("Coincidencia no encontrada")
    if match.version != body.expected_version:
        raise conflict("La coincidencia cambió. Actualiza antes de continuar")
    if action == "reverse":
        if match.status != "confirmed":
            raise conflict("Sólo se revierte una coincidencia confirmada")
        if not body.reason:
            raise bad_request("Indica el motivo de la reversa")
        match.status, match.reversal_reason = "reversed", body.reason
    elif action in {"confirm", "reject"}:
        if match.status != "suggested":
            raise conflict("La coincidencia ya fue revisada")
        if action == "confirm":
            # One payment lock serializes allocation across different settlement entries.
            _lock(db, tenant_id, f"payment:{match.payment_id}")
            payment = (
                db.query(Payment)
                .filter(
                    Payment.tenant_id == tenant_id,
                    Payment.id == match.payment_id,
                    Payment.order_id == match.order_id,
                )
                .first()
            )
            order = (
                db.query(Order)
                .filter(
                    Order.tenant_id == tenant_id,
                    Order.id == match.order_id,
                    Order.branch_id == entry.branch_id,
                )
                .first()
            )
            if (
                payment is None
                or order is None
                or order.status != "completed"
                or payment.method != entry.payment_method
            ):
                raise conflict("La venta o el pago ya no son elegibles")
            available = payment.amount_amount - _allocated(db, tenant_id, payment_id=payment.id)
            remaining = entry.net_amount - _allocated(db, tenant_id, entry_id=entry.id)
            if match.matched_amount > min(available, remaining):
                raise conflict("El importe ya fue asignado. Vuelve a revisar las sugerencias")
            match.status, match.confirmed_by_user_id = "confirmed", user_id
        else:
            match.status = "rejected"
    else:
        raise bad_request("Acción inválida")
    match.version += 1
    match.updated_at = now()
    db.flush()
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=f"reconciliation.match.{match.status}",
        resource_type="reconciliation_match",
        resource_id=match.id,
        changes={
            "entry_id": str(entry.id),
            "payment_id": str(match.payment_id),
            "matched_amount": str(match.matched_amount),
            "version": match.version,
            "reason_recorded": bool(body.reason),
        },
    )
    return _store(db, tenant_id, key, fingerprint, serialize_entry(db, entry))
