"""Durable CFDI journal: uncertain submissions are reconciled, never posted again."""

import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from defusedxml import ElementTree
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.branches.scope import active_branch_id, tenant_wide_branches
from app.cfdi import credentials, pricing
from app.cfdi.models import ACTIVE_STATES, CfdiConnection, CfdiDocument
from app.cfdi.provider import FacturapiProvider, ProviderError
from app.cfdi.schemas import (
    ConnectionInput,
    ConnectionPublic,
    ContextResponse,
    DocumentResponse,
    StatusResponse,
)
from app.config import settings
from app.fiscal import repository as fiscal_repo
from app.integrations.models import FiscalIssuerProfile, InvoiceRequest
from app.integrations.schemas import FiscalIdentity
from app.orders.models import Order, OrderItem, Payment, Refund
from app.pricing.calculator import money
from app.shared.exceptions import bad_request, conflict, not_found
from app.tenants.models import Tenant


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def public(document):
    return DocumentResponse.model_validate(document)


def connection_public(row):
    return ConnectionPublic(
        environment=row.environment,
        organization_id=row.organization_id,
        connected=True,
        issuer_rfc=row.issuer_rfc,
        production_ready=row.production_ready,
        certificate_expires_at=row.certificate_expires_at,
    )


def status(db: Session, tenant_id: UUID):
    rows = (
        db.query(CfdiConnection)
        .filter_by(tenant_id=tenant_id)
        .order_by(CfdiConnection.environment)
        .all()
    )
    return StatusResponse(
        storage_available=credentials.storage_available(),
        connections=[connection_public(row) for row in rows],
    )


def _provider(connection):
    if not credentials.storage_available():
        raise bad_request("El almacenamiento seguro de CFDI no está disponible")
    try:
        key = credentials.decrypt_key(
            tenant_id=connection.tenant_id,
            environment=connection.environment,
            organization_id=connection.organization_id,
            encrypted_key=connection.encrypted_api_key,
        )
    except credentials.CredentialStorageUnavailable:
        raise bad_request("Reconfigura la conexión CFDI del negocio") from None
    return FacturapiProvider(
        key, environment=connection.environment, timeout_seconds=settings.kova_cfdi_timeout_seconds
    )


def _organization_values(organization):
    identifier = organization.get("id")
    if not isinstance(identifier, str) or not identifier or len(identifier) > 100:
        raise bad_request("El proveedor no devolvió una organización válida")
    legal = organization.get("legal") or {}
    rfc = legal.get("tax_id") if isinstance(legal, dict) else None
    if rfc is not None and (not isinstance(rfc, str) or len(rfc) > 13):
        raise bad_request("El proveedor no devolvió un emisor válido")
    cert = organization.get("certificate") or {}
    expiry = None
    if isinstance(cert, dict) and cert.get("expires_at"):
        try:
            expiry = datetime.fromisoformat(str(cert["expires_at"]).replace("Z", "+00:00"))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=UTC)
        except ValueError:
            raise bad_request(
                "El proveedor no devolvió una vigencia de certificado válida"
            ) from None
    ready = (
        organization.get("is_production_ready") is True
        and isinstance(cert, dict)
        and cert.get("has_certificate") is True
        and expiry is not None
        and expiry > datetime.now(UTC)
    )
    return identifier, rfc.upper() if rfc else None, ready, expiry


def _require_issuer(db, tenant_id, rfc, request=None, organization=None):
    profile = db.query(FiscalIssuerProfile).filter_by(tenant_id=tenant_id).first()
    if profile is None or not rfc or profile.fiscal_data.get("rfc") != rfc:
        raise bad_request("El RFC del negocio debe coincidir con la organización del proveedor")
    if request is not None and request.issuer_snapshot.get("rfc") != rfc:
        raise bad_request("El emisor histórico de la solicitud no coincide con la organización")
    if organization is not None:
        legal = organization.get("legal") or {}
        expected = request.issuer_snapshot if request is not None else profile.fiscal_data
        actual = {
            "legal_name": legal.get("legal_name"),
            "tax_regime": legal.get("tax_system"),
            "postal_code": (legal.get("address") or {}).get("zip"),
        }
        for field, value in actual.items():
            if _normalized(value) != _normalized(expected.get(field)):
                raise bad_request(
                    "Nombre, régimen y código postal del emisor deben coincidir con la organización"
                )


def _normalized(value):
    return " ".join(str(value or "").upper().split())


def connect(db: Session, tenant_id: UUID, user_id: UUID, body: ConnectionInput):
    if not credentials.storage_available():
        raise bad_request("El almacenamiento seguro de CFDI no está disponible")
    key = body.api_key.get_secret_value()
    expected = "sk_test_" if body.environment == "test" else "sk_live_"
    if not key.startswith(expected):
        raise bad_request("La llave no corresponde al ambiente seleccionado")
    provider = FacturapiProvider(
        key, environment=body.environment, timeout_seconds=settings.kova_cfdi_timeout_seconds
    )
    try:
        organization = provider.organization()
        values = _organization_values(organization)
    except ProviderError as exc:
        raise bad_request(f"No se pudo verificar la conexión: {exc.code}") from None
    finally:
        provider.close()
    organization_id, rfc, ready, expiry = values
    if body.environment == "live":
        _require_issuer(db, tenant_id, rfc, organization=organization)
    # Serialize connection creation/rotation; organization changes cannot orphan
    # a journal that still needs the old organization to reconcile/cancel.
    db.query(Tenant).filter_by(id=tenant_id).with_for_update().one()
    row = (
        db.query(CfdiConnection)
        .filter_by(tenant_id=tenant_id, environment=body.environment)
        .first()
    )
    if row is not None and row.organization_id != organization_id:
        active = (
            db.query(CfdiDocument)
            .filter_by(tenant_id=tenant_id, environment=body.environment)
            .first()
        )
        if active:
            raise conflict(
                "La organización de un ambiente con documentos históricos no puede reemplazarse"
            )
    if row is None:
        row = CfdiConnection(tenant_id=tenant_id, environment=body.environment)
        db.add(row)
    row.organization_id, row.issuer_rfc, row.production_ready, row.certificate_expires_at = values
    row.refreshed_at = datetime.now(UTC)
    row.encrypted_api_key = credentials.encrypt_key(
        tenant_id=tenant_id,
        environment=body.environment,
        organization_id=organization_id,
        api_key=key,
    )
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="cfdi.connection_updated",
        resource_type="cfdi_connection",
        changes={"environment": body.environment, "organization_id": organization_id},
    )
    db.commit()
    return connection_public(row)


def refresh_connection(db, tenant_id, environment):
    row = db.query(CfdiConnection).filter_by(tenant_id=tenant_id, environment=environment).first()
    if row is None:
        raise not_found("Conexión CFDI no configurada")
    provider = _provider(row)
    try:
        organization = provider.organization()
        values = _organization_values(organization)
    except ProviderError as exc:
        raise bad_request(f"No se pudo verificar la conexión: {exc.code}") from None
    finally:
        provider.close()
    if values[0] != row.organization_id:
        raise conflict("La llave pertenece a otra organización; reconfigura la conexión")
    if environment == "live":
        _require_issuer(db, tenant_id, values[1], organization=organization)
    row.issuer_rfc, row.production_ready, row.certificate_expires_at = values[1:]
    row.refreshed_at = datetime.now(UTC)
    db.commit()
    return connection_public(row)


def _request_order(db, tenant_id, request_id, lock=False):
    request = (
        db.query(InvoiceRequest)
        .filter_by(tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), id=request_id)
        .first()
    )
    if request is None:
        raise not_found("Solicitud de factura no encontrada")
    query = db.query(Order).filter_by(
        tenant_id=tenant_id, branch_id=request.branch_id, id=request.order_id
    )
    order = (query.with_for_update() if lock else query).first()
    if order is None:
        raise not_found("Venta no encontrada")
    if order.status != "completed" or order.total_amount <= 0:
        raise bad_request("El CFDI requiere una venta completada con importe mayor a cero")
    if db.query(Refund.id).filter_by(tenant_id=tenant_id, order_id=order.id).first():
        raise bad_request("Esta entrega no admite facturas de ventas con devoluciones")
    return request, order


def context(db, tenant_id, request_id):
    request, order = _request_order(db, tenant_id, request_id)
    items = (
        db.query(OrderItem)
        .filter_by(tenant_id=tenant_id, order_id=order.id)
        .order_by(OrderItem.id)
        .all()
    )
    payments = db.query(Payment).filter_by(tenant_id=tenant_id, order_id=order.id).all()
    forms = _payment_forms(payments)
    return ContextResponse(
        request_id=request.id,
        order_id=order.id,
        issuer=request.issuer_snapshot,
        recipient=request.recipient_snapshot,
        total_amount=order.total_amount,
        discount_amount=order.discount_amount,
        lines=[
            {
                "order_item_id": item.id,
                "product_name": item.product_name,
                "quantity": item.quantity,
                "unit_price_amount": item.unit_price_amount,
                "discount_amount": item.discount_amount,
                "tax_amount": item.tax_amount,
                "line_total_amount": item.line_total_amount,
            }
            for item in items
        ],
        payments=[
            {"method": payment.method, "amount": str(payment.amount_amount)} for payment in payments
        ],
        suggested_payment_forms=sorted(forms),
    )


def _payment_forms(payments):
    # A split sale uses the tender with the greatest collected amount (SAT rule).
    totals = {}
    for payment in payments:
        totals[payment.method] = totals.get(payment.method, Decimal(0)) + payment.amount_amount
    if not totals:
        raise bad_request("La venta no tiene pagos registrados")
    largest = max(totals.values())
    mapping = {"cash": {"01"}, "bank_transfer": {"03"}, "manual_card": {"04", "28"}}
    return set().union(
        *(mapping.get(method, set()) for method, amount in totals.items() if amount == largest)
    )


def preview(db, tenant_id, body):
    request, order = _request_order(db, tenant_id, body.request_id)
    payments = db.query(Payment).filter_by(tenant_id=tenant_id, order_id=order.id).all()
    if body.payment_form not in _payment_forms(payments):
        raise bad_request("La forma de pago debe corresponder al medio realmente cobrado")
    items = (
        db.query(OrderItem)
        .filter_by(tenant_id=tenant_id, order_id=order.id)
        .order_by(OrderItem.id)
        .all()
    )
    return pricing.prepare(request, order, items, body)


def live_reservation(db: Session, tenant_id: UUID, order_id: UUID):
    return (
        db.query(CfdiDocument)
        .filter_by(tenant_id=tenant_id, order_id=order_id, environment="live")
        .filter(CfdiDocument.state.in_(ACTIVE_STATES))
        .first()
    )


def live_reserved_order_ids(db: Session, tenant_id: UUID):
    return {
        row[0]
        for row in db.query(CfdiDocument.order_id)
        .filter_by(tenant_id=tenant_id, environment="live")
        .filter(CfdiDocument.state.in_(ACTIVE_STATES))
        .all()
    }


def _document(db, tenant_id, document_id, lock=False):
    query = db.query(CfdiDocument).filter_by(
        tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), id=document_id
    )
    row = (query.with_for_update() if lock else query).first()
    if row is None:
        raise not_found("Documento CFDI no encontrado")
    return row


def documents(db, tenant_id, request_id=None, environment=None):
    query = db.query(CfdiDocument).filter_by(
        tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id)
    )
    if request_id is not None:
        query = query.filter_by(request_id=request_id)
    if environment is not None:
        query = query.filter_by(environment=environment)
    return [public(row) for row in query.order_by(CfdiDocument.created_at.desc()).limit(50).all()]


def _canonical(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: _canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    return value


def _wire_payload(payload):
    # Restore only known monetary fields, never arbitrary recipient strings.
    result = json.loads(json.dumps(payload))
    for item in result["items"]:
        item["discount"] = Decimal(item["discount"])
        item["product"]["price"] = Decimal(item["product"]["price"])
        for tax in item["product"]["taxes"]:
            if "rate" in tax:
                tax["rate"] = Decimal(tax["rate"])
    return result


def create_document(db, tenant_id, user_id, body, key):
    if not key or len(key) > 200:
        raise bad_request("Idempotency-Key debe contener entre 1 y 200 caracteres")
    db.query(Tenant).filter_by(id=tenant_id).with_for_update().one()
    digest = fingerprint(body.model_dump(mode="json"))
    with tenant_wide_branches(db):
        existing = (
            db.query(CfdiDocument).filter_by(tenant_id=tenant_id, idempotency_key=key).first()
        )
    if existing:
        if existing.branch_id != active_branch_id(db, tenant_id) or existing.request_hash != digest:
            raise conflict("La llave ya se utilizó para otra preparación")
        return public(existing)
    request, order = _request_order(db, tenant_id, body.request_id, lock=True)
    active = (
        db.query(CfdiDocument)
        .filter_by(tenant_id=tenant_id, order_id=order.id, environment=body.environment)
        .filter(CfdiDocument.state.in_(ACTIVE_STATES))
        .first()
    )
    if active:
        raise conflict("La venta ya tiene un documento vigente; consulta o reconcilia su estado")
    previous_event = fiscal_repo.latest_individual_invoice_event(
        db, tenant_id=tenant_id, order_id=order.id
    )
    if body.environment == "live" and previous_event and previous_event.status == "confirmed":
        raise conflict("La venta ya está registrada como facturada individualmente")
    prepared, payload = preview(db, tenant_id, body)
    connection = (
        db.query(CfdiConnection)
        .filter_by(tenant_id=tenant_id, environment=body.environment)
        .with_for_update()
        .first()
    )
    if connection is None:
        raise bad_request("Conecta primero la organización del ambiente seleccionado")
    provider = _provider(connection)
    if body.environment == "live":
        # Revalidate certificates immediately before a new Live effect.
        try:
            organization = provider.organization()
            values = _organization_values(organization)
        except ProviderError as exc:
            provider.close()
            raise bad_request(f"No se pudo verificar el emisor: {exc.code}") from None
        if values[0] != connection.organization_id or not values[2]:
            provider.close()
            raise bad_request(
                "El emisor Live requiere una organización lista y certificados vigentes"
            )
        _require_issuer(db, tenant_id, values[1], request, organization=organization)
    identifier = uuid4()
    external_id = f"kova-{body.environment}-{identifier}"
    provider_key = f"kova-{body.environment}-{connection.organization_id}-{identifier}"
    payload["external_id"] = external_id
    row = CfdiDocument(
        id=identifier,
        tenant_id=tenant_id,
        branch_id=order.branch_id,
        order_id=order.id,
        request_id=request.id,
        connection_id=connection.id,
        environment=body.environment,
        organization_id=connection.organization_id,
        state="submitting",
        idempotency_key=key,
        request_hash=digest,
        external_id=external_id,
        provider_key=provider_key,
        payload=_canonical(payload),
        total_amount=prepared.total_amount,
        created_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="cfdi.submission_reserved",
        resource_type="cfdi_document",
        resource_id=row.id,
        changes={"environment": row.environment, "state": row.state},
    )
    db.commit()  # The durable journal/reservation MUST precede the external POST.
    try:
        result = provider.create_invoice(payload, idempotency_key=provider_key)
        return _apply_result(db, tenant_id, identifier, result, provider, user_id)
    except ProviderError as exc:
        row = _document(db, tenant_id, identifier, lock=True)
        row.state = "rejected" if exc.definitive else "unknown"
        row.last_error_code = exc.code
        db.commit()
        return public(row)
    finally:
        provider.close()


def validate_xml(content, document, request, response):
    if not isinstance(content, bytes) or not content or len(content) > 10 * 1024 * 1024:
        raise ValueError("invalid_xml_size")
    try:
        if Decimal(str(response.get("total", ""))) != document.total_amount:
            raise ValueError()
        root = ElementTree.fromstring(content)
        ns = {"c": "http://www.sat.gob.mx/cfd/4", "t": "http://www.sat.gob.mx/TimbreFiscalDigital"}
        issuer = root.find("c:Emisor", ns)
        recipient = root.find("c:Receptor", ns)
        stamps = root.findall(".//t:TimbreFiscalDigital", ns)
        if (
            root.tag != "{http://www.sat.gob.mx/cfd/4}Comprobante"
            or root.get("Version") != "4.0"
            or root.get("TipoDeComprobante") != "I"
            or root.get("Moneda") != "MXN"
        ):
            raise ValueError()
        if issuer is None or recipient is None or len(stamps) != 1:
            raise ValueError()
        if recipient.get("Rfc") != document.payload["customer"]["tax_id"]:
            raise ValueError()
        if document.environment == "live" and issuer.get("Rfc") != request.issuer_snapshot["rfc"]:
            raise ValueError()
        # Test stamping uses the provider's fictitious issuer and has no legal validity.
        if document.environment == "test":
            FiscalIdentity(
                rfc=issuer.get("Rfc"),
                legal_name=issuer.get("Nombre"),
                tax_regime=issuer.get("RegimenFiscal"),
                postal_code=root.get("LugarExpedicion"),
            )
        frozen_recipient = document.recipient_snapshot
        if (
            (
                document.environment == "live"
                and (
                    _normalized(issuer.get("Nombre"))
                    != _normalized(request.issuer_snapshot["legal_name"])
                    or issuer.get("RegimenFiscal") != request.issuer_snapshot["tax_regime"]
                    or root.get("LugarExpedicion") != request.issuer_snapshot["postal_code"]
                )
            )
            or _normalized(recipient.get("Nombre")) != _normalized(frozen_recipient["legal_name"])
            or recipient.get("RegimenFiscalReceptor") != frozen_recipient["tax_regime"]
            or recipient.get("DomicilioFiscalReceptor") != frozen_recipient["postal_code"]
            or recipient.get("UsoCFDI") != frozen_recipient["cfdi_use"]
        ):
            raise ValueError()
        expected_items = _wire_payload(document.payload)["items"]
        concepts = root.findall("c:Conceptos/c:Concepto", ns)
        if len(concepts) != len(expected_items) or root.findall(".//c:Retencion", ns):
            raise ValueError()
        gross_sum, discount_sum, tax_sum = Decimal(0), Decimal(0), Decimal(0)
        for concept, expected in zip(concepts, expected_items, strict=True):
            product = expected["product"]
            gross = pricing.six(product["price"] * expected["quantity"])
            discount = expected["discount"]
            net = pricing.six(gross - discount)
            if (
                concept.get("ClaveProdServ") != product["product_key"]
                or concept.get("ClaveUnidad") != product["unit_key"]
                or concept.get("ObjetoImp") != product["taxability"]
                or Decimal(concept.get("Cantidad", "")) != expected["quantity"]
                or Decimal(concept.get("ValorUnitario", "")) != product["price"]
                or Decimal(concept.get("Importe", "")) != gross
                or Decimal(concept.get("Descuento", "0")) != discount
                or _normalized(concept.get("Descripcion")) != _normalized(product["description"])
            ):
                raise ValueError()
            transfers = concept.findall("c:Impuestos/c:Traslados/c:Traslado", ns)
            if len(transfers) != len(product["taxes"]):
                raise ValueError()
            for transfer, tax in zip(transfers, product["taxes"], strict=True):
                if (
                    transfer.get("Impuesto") != "002"
                    or transfer.get("TipoFactor") != tax["factor"]
                    or Decimal(transfer.get("Base", "")) != net
                ):
                    raise ValueError()
                if tax["factor"] == "Tasa":
                    amount = pricing.six(net * tax["rate"])
                    if (
                        Decimal(transfer.get("TasaOCuota", "")) != tax["rate"]
                        or Decimal(transfer.get("Importe", "")) != amount
                    ):
                        raise ValueError()
                    tax_sum += amount
                elif transfer.get("TasaOCuota") is not None or transfer.get("Importe") is not None:
                    raise ValueError()
            gross_sum += gross
            discount_sum += discount
        root_taxes = root.find("c:Impuestos", ns)
        if (
            Decimal(root.get("SubTotal", "")) != money(gross_sum)
            or Decimal(root.get("Descuento", "0")) != money(discount_sum)
            or Decimal(
                root_taxes.get("TotalImpuestosTrasladados", "0") if root_taxes is not None else "0"
            )
            != money(tax_sum)
        ):
            raise ValueError()
        stamped_uuid = UUID(stamps[0].get("UUID", ""))
        if (
            stamped_uuid != UUID(str(response.get("uuid", "")))
            or Decimal(root.get("Total", "")) != document.total_amount
        ):
            raise ValueError()
        if (
            root.get("MetodoPago") != "PUE"
            or root.get("FormaPago") != document.payload["payment_form"]
        ):
            raise ValueError()
        if (
            not stamps[0].get("SelloSAT")
            or not stamps[0].get("SelloCFD")
            or not stamps[0].get("FechaTimbrado")
        ):
            raise ValueError()
        return stamped_uuid
    except Exception:
        raise ValueError("cfdi_xml_integrity_error") from None


def _ledger(db, row, user_id, confirmed):
    if row.environment != "live":
        return
    status = "confirmed" if confirmed else "reopened"
    fiscal_repo.create_individual_invoice_event(
        db,
        tenant_id=row.tenant_id,
        order_id=row.order_id,
        user_id=user_id,
        status=status,
        external_reference=str(row.uuid) if confirmed else None,
        issued_at=datetime.now(UTC) if confirmed else None,
    )


def _apply_result(db, tenant_id, identifier, result, provider, user_id):
    row = _document(db, tenant_id, identifier, lock=True)
    if row.state == "canceled":
        return public(row)
    if result.get("livemode") is not (row.environment == "live"):
        row.state, row.last_error_code = "integrity_error", "provider_environment_mismatch"
    elif result.get("external_id") != row.external_id:
        row.state, row.last_error_code = "integrity_error", "provider_external_id_mismatch"
    else:
        identifier = result.get("id")
        if not isinstance(identifier, str) or not identifier or len(identifier) > 100:
            row.state, row.last_error_code = "unknown", "provider_invalid_response"
        elif row.provider_id and row.provider_id != identifier:
            row.state, row.last_error_code = "integrity_error", "provider_id_mismatch"
        else:
            row.provider_id = identifier
            provider_status = result.get("status")
            cancellation = result.get("cancellation_status")
            row.cancellation_status = (
                cancellation if isinstance(cancellation, str) and len(cancellation) <= 40 else None
            )
            if provider_status in {"valid", "canceled"}:
                try:
                    request = (
                        db.query(InvoiceRequest)
                        .filter_by(tenant_id=tenant_id, id=row.request_id)
                        .one()
                    )
                    content = row.xml_bytes or provider.download_xml(identifier)
                    stamped_uuid = validate_xml(content, row, request, result)
                    if row.uuid is not None and row.uuid != stamped_uuid:
                        raise ValueError("provider_uuid_mismatch")
                    was_issued = row.confirmed_at is not None
                    row.xml_bytes, row.uuid = content, stamped_uuid
                    if not was_issued:
                        _ledger(db, row, user_id, True)
                        row.confirmed_at = datetime.now(UTC)
                    if provider_status == "canceled" and cancellation == "accepted":
                        row.state = "canceled"
                        if row.canceled_at is None:
                            _ledger(db, row, user_id, False)
                            row.canceled_at = datetime.now(UTC)
                    else:
                        row.state = (
                            "cancel_pending"
                            if row.cancellation_payload
                            and cancellation not in {"rejected", "expired"}
                            else "issued"
                        )
                    row.last_error_code = None
                except ProviderError as exc:
                    row.state, row.last_error_code = "unknown", exc.code
                except ValueError:
                    row.state, row.last_error_code = "integrity_error", "cfdi_xml_integrity_error"
            elif provider_status == "failed":
                row.state, row.last_error_code = (
                    ("integrity_error" if row.confirmed_at else "rejected"),
                    "provider_invoice_failed",
                )
            elif provider_status == "pending":
                row.state, row.last_error_code = (
                    ("integrity_error", "provider_state_regression")
                    if row.confirmed_at
                    else ("pending", None)
                )
            else:
                row.state, row.last_error_code = (
                    ("integrity_error" if row.confirmed_at else "unknown"),
                    "provider_invalid_state",
                )
    row.updated_at = datetime.now(UTC)
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="cfdi.state_reconciled",
        resource_type="cfdi_document",
        resource_id=row.id,
        changes={"environment": row.environment, "state": row.state, "error": row.last_error_code},
    )
    db.commit()
    return public(row)


def reconcile(db, tenant_id, user_id, document_id):
    row = _document(db, tenant_id, document_id)
    if row.state in {"canceled", "rejected"}:
        return public(row)
    connection = db.query(CfdiConnection).filter_by(tenant_id=tenant_id, id=row.connection_id).one()
    if connection.organization_id != row.organization_id:
        raise conflict("La organización de este documento ya no está conectada")
    provider = _provider(connection)
    try:
        result = (
            provider.get_invoice(row.provider_id)
            if row.provider_id
            else provider.find_invoice(row.external_id)
        )
        if result is None:
            row = _document(db, tenant_id, document_id, lock=True)
            row.last_error_code = "provider_invoice_not_found"
            # The original POST may still be in flight: keep the reservation.
            db.commit()
            return public(row)
        return _apply_result(db, tenant_id, document_id, result, provider, user_id)
    except ProviderError as exc:
        row.last_error_code = exc.code
        db.commit()
        return public(row)
    finally:
        provider.close()


def cancel(db, tenant_id, user_id, document_id, body, key):
    if not key or len(key) > 200:
        raise bad_request("Idempotency-Key debe contener entre 1 y 200 caracteres")
    row = _document(db, tenant_id, document_id, lock=True)
    digest = fingerprint(body.model_dump(mode="json"))
    if row.cancellation_key == key:
        if row.cancellation_hash != digest:
            raise conflict("La llave ya se utilizó con otro motivo de cancelación")
        return public(row)
    if row.state != "issued" or not row.provider_id or not row.uuid:
        raise conflict(
            "Sólo se puede solicitar cancelación de un CFDI confirmado; reconcilia primero"
        )
    connection = db.query(CfdiConnection).filter_by(tenant_id=tenant_id, id=row.connection_id).one()
    provider = _provider(connection)
    row.cancellation_key, row.cancellation_hash = key, digest
    row.cancellation_payload = body.model_dump(mode="json")
    row.state, row.cancellation_status = "cancel_pending", "pending"
    provider_id = row.provider_id
    db.commit()  # Reserve the cancellation before the provider effect as well.
    try:
        provider.cancel_invoice(
            provider_id,
            body.motive,
            str(body.substitution_uuid) if body.substitution_uuid else None,
        )
        # HTTP 200/DELETE receipt is not a confirmed SAT cancellation.
        result = provider.get_invoice(provider_id)
        return _apply_result(db, tenant_id, document_id, result, provider, user_id)
    except ProviderError as exc:
        row = _document(db, tenant_id, document_id, lock=True)
        row.last_error_code = exc.code
        db.commit()
        return public(row)
    finally:
        provider.close()


def xml(db, tenant_id, document_id):
    row = _document(db, tenant_id, document_id)
    if row.xml_bytes is None:
        raise conflict("El XML todavía no está validado; reconcilia el documento")
    return row, row.xml_bytes


def pdf(db, tenant_id, document_id):
    row = _document(db, tenant_id, document_id)
    if (
        not row.provider_id
        or not row.xml_bytes
        or row.state not in {"issued", "cancel_pending", "canceled"}
    ):
        raise conflict("El documento todavía no está confirmado")
    connection = db.query(CfdiConnection).filter_by(tenant_id=tenant_id, id=row.connection_id).one()
    provider = _provider(connection)
    try:
        content = provider.download_pdf(row.provider_id)
        if not isinstance(content, bytes) or not content.startswith(b"%PDF-"):
            raise bad_request("El proveedor no devolvió un PDF válido")
        return row, content
    except ProviderError as exc:
        raise bad_request(f"No se pudo descargar el PDF: {exc.code}") from None
    finally:
        provider.close()
