"""Commercial records never create sales, reserves, payments or outbound messages."""

import hashlib
import re
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth.models import Membership, User
from app.branches.scope import active_branch_id
from app.crm.models import ContactConsent, Opportunity, now
from app.crm.schemas import ConsentResponse, OpportunityResponse
from app.customers.models import Customer
from app.idempotency import service as idempotency
from app.shared.exceptions import bad_request, conflict, not_found


def _customer(db, tenant_id, customer_id, *, lock=False):
    query = db.query(Customer).filter(Customer.tenant_id == tenant_id, Customer.id == customer_id)
    customer = query.with_for_update().first() if lock else query.first()
    if customer is None:
        raise not_found("Cliente no encontrado")
    return customer


def _assignee(db, tenant_id, user_id):
    if user_id is None:
        return
    member = (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant_id,
            Membership.user_id == user_id,
            Membership.is_active.is_(True),
            User.is_active.is_(True),
            or_(
                Membership.allowed_branch_id.is_(None),
                Membership.allowed_branch_id == active_branch_id(db, tenant_id),
            ),
        )
        .first()
    )
    if member is None:
        raise not_found("Responsable no disponible en esta sucursal")


def _serialize_opportunity(db, row, customer=None):
    customer = customer or _customer(db, row.tenant_id, row.customer_id)
    values = {
        name: getattr(row, name)
        for name in OpportunityResponse.model_fields
        if name != "customer_name"
    }
    return OpportunityResponse(**values, customer_name=customer.name).model_dump(mode="json")


def _serialize_consent(db, row, customer=None):
    customer = customer or _customer(db, row.tenant_id, row.customer_id)
    fields = {
        name: getattr(row, name)
        for name in ConsentResponse.model_fields
        if name not in {"customer_name", "contact_current"}
    }
    current_hash = _contact_fingerprint(customer, row.channel)
    return ConsentResponse(
        **fields,
        customer_name=customer.name,
        contact_current=bool(
            customer.is_active and current_hash and current_hash == row.contact_fingerprint
        ),
    ).model_dump(mode="json")


def _request(db, tenant_id, key, scope, body):
    if not key or len(key) > 255 or not key.strip():
        raise bad_request("Idempotency-Key debe contener entre 1 y 255 caracteres")
    fingerprint = hashlib.sha256(f"crm:{scope}:{body.model_dump_json()}".encode()).hexdigest()
    replay = idempotency.claim(db, tenant_id=tenant_id, key=key, request_hash=fingerprint)
    return fingerprint, replay


def _commit(db, tenant_id, user_id, key, fingerprint, row, result, action, status=200):
    # Only identifiers and field names belong in audit; no notes, names or contact details.
    changes = {"version": row.version}
    if isinstance(row, ContactConsent):
        changes.update(channel=row.channel, purpose=row.purpose, enabled=row.enabled)
    else:
        changes["stage"] = row.stage
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type="contact_consent" if isinstance(row, ContactConsent) else "crm_opportunity",
        resource_id=row.id,
        changes=changes,
    )
    idempotency.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=fingerprint,
        response_status=status,
        response_body=result,
    )
    db.commit()
    return status, result


def get_opportunity(db: Session, tenant_id: UUID, opportunity_id: UUID):
    row = db.query(Opportunity).filter_by(
        tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), id=opportunity_id
    ).first()
    if row is None:
        raise not_found("Oportunidad no encontrada")
    return _serialize_opportunity(db, row)


def overview(db: Session, tenant_id: UUID, *, limit=100, offset=0, customer_id=None):
    branch_id = active_branch_id(db, tenant_id)
    if customer_id is not None:
        _customer(db, tenant_id, customer_id)
    opportunity_query = db.query(Opportunity).filter(
        Opportunity.tenant_id == tenant_id, Opportunity.branch_id == branch_id
    )
    consent_query = db.query(ContactConsent).filter(
        ContactConsent.tenant_id == tenant_id, ContactConsent.branch_id == branch_id
    )
    if customer_id is not None:
        opportunity_query = opportunity_query.filter(Opportunity.customer_id == customer_id)
        consent_query = consent_query.filter(ContactConsent.customer_id == customer_id)
    rows = (
        opportunity_query.order_by(Opportunity.updated_at.desc(), Opportunity.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    consents = (
        consent_query.order_by(ContactConsent.updated_at.desc(), ContactConsent.id)
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    customer_ids = {row.customer_id for row in [*rows[:limit], *consents[:limit]]}
    customers = {
        customer.id: customer
        for customer in db.query(Customer)
        .filter(Customer.tenant_id == tenant_id, Customer.id.in_(customer_ids))
        .all()
    }
    return {
        "opportunities": [
            _serialize_opportunity(db, row, customers.get(row.customer_id)) for row in rows[:limit]
        ],
        "consents": [
            _serialize_consent(db, row, customers.get(row.customer_id)) for row in consents[:limit]
        ],
        "capabilities": {"whatsapp": "not_connected", "email": "not_connected"},
        "opportunities_has_more": len(rows) > limit,
        "consents_has_more": len(consents) > limit,
    }


def create_opportunity(db, tenant_id, user_id, body, key):
    fingerprint, replay = _request(db, tenant_id, key, "create_opportunity", body)
    if replay:
        return replay.response_status, replay.response_body
    customer = _customer(db, tenant_id, body.customer_id)
    if not customer.is_active:
        raise bad_request("Reactiva al cliente antes de crear una oportunidad")
    _assignee(db, tenant_id, body.assigned_user_id)
    row = Opportunity(
        tenant_id=tenant_id,
        branch_id=active_branch_id(db, tenant_id),
        **body.model_dump(),
        created_by_user_id=user_id,
        updated_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    return _commit(
        db,
        tenant_id,
        user_id,
        key,
        fingerprint,
        row,
        _serialize_opportunity(db, row),
        "crm.opportunity.created",
        201,
    )


def update_opportunity(db, tenant_id, user_id, opportunity_id, body, key):
    fingerprint, replay = _request(db, tenant_id, key, f"update_opportunity:{opportunity_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    row = (
        db.query(Opportunity)
        .filter(
            Opportunity.tenant_id == tenant_id,
            Opportunity.id == opportunity_id,
            Opportunity.branch_id == active_branch_id(db, tenant_id),
        )
        .with_for_update()
        .first()
    )
    if row is None:
        raise not_found("Oportunidad no encontrada")
    if row.version != body.expected_version:
        raise conflict("La oportunidad cambió. Actualiza antes de guardar")
    fields = body.model_dump(exclude_unset=True, exclude={"expected_version"})
    if "assigned_user_id" in fields:
        _assignee(db, tenant_id, fields["assigned_user_id"])
    for name, value in fields.items():
        setattr(row, name, value)
    row.version += 1
    row.updated_at = now()
    row.updated_by_user_id = user_id
    db.flush()
    return _commit(
        db,
        tenant_id,
        user_id,
        key,
        fingerprint,
        row,
        _serialize_opportunity(db, row),
        "crm.opportunity.updated",
    )


def _contact_fingerprint(customer, channel):
    contact = customer.phone if channel == "whatsapp" else customer.email
    if not contact:
        return None
    normalized = re.sub(r"\D", "", contact) if channel == "whatsapp" else contact.strip().casefold()
    if not normalized:
        return None
    return hashlib.sha256(f"{channel}:{normalized}".encode()).hexdigest()


def save_consent(db, tenant_id, user_id, body, key):
    fingerprint, replay = _request(db, tenant_id, key, "save_consent", body)
    if replay:
        return replay.response_status, replay.response_body
    # Lock customer to serialize creation when no consent row exists yet.
    customer = _customer(db, tenant_id, body.customer_id, lock=True)
    contact_hash = _contact_fingerprint(customer, body.channel)
    if body.enabled and (not customer.is_active or contact_hash is None):
        raise bad_request("El cliente debe estar activo y tener un contacto para este canal")
    row = (
        db.query(ContactConsent)
        .filter(
            ContactConsent.tenant_id == tenant_id,
            ContactConsent.branch_id == active_branch_id(db, tenant_id),
            ContactConsent.customer_id == body.customer_id,
            ContactConsent.channel == body.channel,
            ContactConsent.purpose == body.purpose,
        )
        .with_for_update()
        .first()
    )
    if body.expected_version != (row.version if row else 0):
        raise conflict("El consentimiento cambió. Actualiza antes de guardar")
    if row is None:
        row = ContactConsent(
            tenant_id=tenant_id,
            branch_id=active_branch_id(db, tenant_id),
            customer_id=body.customer_id,
            channel=body.channel,
            purpose=body.purpose,
            version=1,
        )
        db.add(row)
    else:
        row.version += 1
    row.enabled = body.enabled
    row.contact_fingerprint = contact_hash if body.enabled else None
    row.recorded_by_user_id = user_id
    row.updated_at = now()
    db.flush()
    result = _serialize_consent(db, row)
    return _commit(
        db,
        tenant_id,
        user_id,
        key,
        fingerprint,
        row,
        result,
        "crm.consent.recorded",
    )


def contact_allowed(db, *, tenant_id, branch_id, customer_id, channel, purpose):
    """Future dispatchers must recheck immediately before sending, including address changes.

    This predicate does not authorize a provider, user, rule, billing state or outbound send.
    It only establishes the current consent for one explicit branch/channel/purpose.
    """
    if channel not in {"whatsapp", "email"} or purpose not in {"transactional", "marketing"}:
        return False
    customer = (
        db.query(Customer)
        .filter(
            Customer.tenant_id == tenant_id,
            Customer.id == customer_id,
            Customer.is_active.is_(True),
        )
        .first()
    )
    if customer is None:
        return False
    row = (
        db.query(ContactConsent)
        .filter(
            ContactConsent.tenant_id == tenant_id,
            ContactConsent.branch_id == branch_id,
            ContactConsent.customer_id == customer_id,
            ContactConsent.channel == channel,
            ContactConsent.purpose == purpose,
            ContactConsent.enabled.is_(True),
        )
        .first()
    )
    current_hash = _contact_fingerprint(customer, channel)
    return bool(row and current_hash and current_hash == row.contact_fingerprint)
