"""Kova-managed fiscal enrollment. External creates are journaled before dispatch."""

import re
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.audit import service as audit
from app.branches.scope import tenant_wide_branches
from app.cfdi import credentials
from app.cfdi.models import CfdiConnection, CfdiDocument, CfdiEnrollment
from app.cfdi.provider import ProviderError
from app.cfdi.schemas import SetupResponse
from app.cfdi.service import _normalized, _organization_values
from app.config import settings
from app.integrations.models import FiscalIssuerProfile
from app.integrations.schemas import FiscalIdentity
from app.shared.exceptions import bad_request, conflict
from app.tenants.models import Tenant

MANIFEST_URL = "https://www.facturapi.io/embedded/manifiesto"
# More than the bounded provider calls; a crashed worker can be reconciled later.
OPERATION_LEASE = timedelta(minutes=5)


def available():
    key = settings.kova_facturapi_user_key
    return bool(
        credentials.storage_available()
        and key
        and re.fullmatch(r"sk_user_[\x21-\x7e]{1,4000}", key.get_secret_value())
    )


def _provider():
    from app.cfdi.managed_provider import FacturapiManagementProvider

    if not available():
        raise bad_request("La activación de facturación de Kova aún no está disponible")
    return FacturapiManagementProvider(
        settings.kova_facturapi_user_key.get_secret_value(),
        timeout_seconds=settings.kova_cfdi_timeout_seconds,
    )


def organization_name(tenant_id):
    # Immutable, unambiguous external recovery marker; no customer PII.
    return f"Kova {tenant_id}"


def _lock(db, tenant_id):
    db.query(Tenant).filter_by(id=tenant_id).with_for_update().one()
    return db.query(CfdiEnrollment).filter_by(tenant_id=tenant_id).first()


def status(db: Session, tenant_id: UUID):
    row = db.query(CfdiEnrollment).filter_by(tenant_id=tenant_id).first()
    profile = db.query(FiscalIssuerProfile).filter_by(tenant_id=tenant_id).first()
    issuer = FiscalIdentity(**profile.fiscal_data) if profile else None
    connections = db.query(CfdiConnection).filter_by(tenant_id=tenant_id).all()
    test = next((item for item in connections if item.environment == "test"), None)
    live = next((item for item in connections if item.environment == "live"), None)
    ready = bool(
        credentials.storage_available()
        and issuer
        and live
        and live.production_ready
        and live.issuer_rfc == issuer.rfc
        and live.certificate_expires_at
        and live.certificate_expires_at > datetime.now(UTC)
    )
    return SetupResponse(
        available=available(),
        state=row.state if row else ("legacy" if connections else "not_started"),
        issuer=issuer,
        organization_created=bool(row and row.organization_id),
        test_connected=bool(test),
        live_connected=bool(live),
        production_ready=ready,
        certificate_expires_at=live.certificate_expires_at if live else None,
        last_error_code=row.last_error_code if row else None,
        manifest_url=MANIFEST_URL if row and row.organization_id else None,
    )


def _claim(db, tenant_id, issuer=None):
    row = _lock(db, tenant_id)
    with tenant_wide_branches(db):
        unresolved = (
            db.query(CfdiDocument)
            .filter_by(tenant_id=tenant_id, environment="live")
            .filter(
                CfdiDocument.state.in_(
                    (
                        "prepared",
                        "submitting",
                        "unknown",
                        "pending",
                        "cancel_pending",
                        "integrity_error",
                    )
                )
            )
            .first()
        )
    if unresolved:
        raise conflict("Resuelve los CFDI pendientes antes de cambiar la configuración fiscal")
    if row and row.operation_id and row.updated_at > datetime.now(UTC) - OPERATION_LEASE:
        raise conflict("La activación fiscal está en curso; espera y actualiza su estado")
    if row is None:
        if issuer is None:
            raise bad_request("Activa primero la facturación de tu negocio")
        if db.query(CfdiConnection).filter_by(tenant_id=tenant_id).first():
            raise conflict("La conexión fiscal existente requiere una migración asistida")
        row = CfdiEnrollment(
            tenant_id=tenant_id,
            issuer_snapshot=issuer.model_dump(mode="json"),
            state="creating",
        )
        db.add(row)
    elif issuer and row.issuer_snapshot["rfc"] != issuer.rfc:
        raise conflict("El RFC de una organización fiscal activada no puede reemplazarse")
    token = uuid4()
    # An interrupted creation MUST be searched, never posted again automatically.
    recover = not row.organization_id and not row.creation_rejected
    # A brand new row hasn't dispatched yet.
    if row in db.new:
        recover = False
    row.creation_rejected = False
    row.operation_id, row.state = token, "creating"
    row.updated_at = datetime.now(UTC)
    db.commit()
    return row, token, recover


def _owned(db, tenant_id, token):
    row = _lock(db, tenant_id)
    if row is None or row.operation_id != token:
        raise conflict("La activación cambió; actualiza su estado antes de continuar")
    return row


def _checkpoint(db, tenant_id, token, **values):
    row = _owned(db, tenant_id, token)
    for field, value in values.items():
        setattr(row, field, value)
    row.updated_at = datetime.now(UTC)
    db.commit()
    return row


def _fail(db, tenant_id, token, exc, *, creation_attempted=False):
    db.rollback()
    row = _owned(db, tenant_id, token)
    row.creation_rejected = bool(creation_attempted and exc.definitive)
    row.state = "unknown" if not row.organization_id and not row.creation_rejected else "error"
    row.operation_id = None
    row.last_error_code = exc.code
    row.updated_at = datetime.now(UTC)
    db.commit()
    raise bad_request(
        "No pudimos completar la activación fiscal. Actualiza el estado para recuperar el proceso."
    ) from None


def _validate_organization(organization, tenant_id, expected_id=None):
    values = _organization_values(organization)
    if expected_id and values[0] != expected_id:
        raise ProviderError("provider_identifier_mismatch", definitive=False)
    legal = organization.get("legal") or {}
    name = legal.get("name", organization.get("name"))
    if name != organization_name(tenant_id):
        raise ProviderError("provider_organization_binding_mismatch", definitive=False)
    return values


def _sync(db, tenant_id, token, organization):
    row = _owned(db, tenant_id, token)
    values = _validate_organization(organization, tenant_id, row.organization_id)
    issuer = row.issuer_snapshot
    legal = organization.get("legal") or {}
    ready = (
        values[2]
        and values[1] == issuer["rfc"]
        and all(
            _normalized(actual) == _normalized(issuer[field])
            for field, actual in (
                ("legal_name", legal.get("legal_name")),
                ("tax_regime", legal.get("tax_system")),
                ("postal_code", (legal.get("address") or {}).get("zip")),
            )
        )
    )
    for connection in db.query(CfdiConnection).filter_by(tenant_id=tenant_id).all():
        if connection.organization_id != row.organization_id:
            raise ProviderError("provider_organization_binding_mismatch", definitive=False)
        connection.issuer_rfc, connection.production_ready = values[1], bool(ready)
        connection.certificate_expires_at = values[3]
        connection.refreshed_at = datetime.now(UTC)
    row.state, row.operation_id, row.last_error_code = "configured", None, None
    row.updated_at = datetime.now(UTC)
    audit.log(
        db,
        action="fiscal.enrollment_refreshed",
        tenant_id=tenant_id,
        resource_type="cfdi_enrollment",
        resource_id=tenant_id,
        changes={"ready": bool(ready)},
    )
    db.commit()
    return status(db, tenant_id)


def _keys(db, tenant_id, token, provider):
    row = _owned(db, tenant_id, token)
    identifier = row.organization_id
    db.commit()
    for environment in ("test", "live"):
        _owned(db, tenant_id, token)
        existing = (
            db.query(CfdiConnection)
            .filter_by(
                tenant_id=tenant_id,
                environment=environment,
            )
            .first()
        )
        if existing:
            if existing.organization_id != identifier:
                raise ProviderError("provider_organization_binding_mismatch", definitive=False)
            db.commit()
            continue
        db.commit()
        key = (
            provider.test_key(identifier)
            if environment == "test"
            else provider.live_key(identifier)
        )
        _owned(db, tenant_id, token)
        db.add(
            CfdiConnection(
                tenant_id=tenant_id,
                environment=environment,
                organization_id=identifier,
                encrypted_api_key=credentials.encrypt_key(
                    tenant_id=tenant_id,
                    environment=environment,
                    organization_id=identifier,
                    api_key=key,
                ),
                issuer_rfc=None,
                production_ready=False,
            )
        )
        db.commit()


def activate(db: Session, tenant_id: UUID, user_id: UUID, issuer: FiscalIdentity):
    if len(issuer.legal_name) > 100:
        raise bad_request("La razón social debe tener como máximo 100 caracteres para facturación")
    with _provider() as provider:
        row, token, recover = _claim(db, tenant_id, issuer)
        creation_attempted = False
        try:
            if not row.organization_id:
                creation_attempted = not recover
                organization = (
                    provider.find_organization(organization_name(tenant_id))
                    if recover
                    else provider.create_organization(organization_name(tenant_id))
                )
                if organization is None:
                    raise ProviderError("provider_creation_unresolved", definitive=False)
                values = _validate_organization(organization, tenant_id)
                row = _checkpoint(db, tenant_id, token, organization_id=values[0])
            profile = db.query(FiscalIssuerProfile).filter_by(tenant_id=tenant_id).first()
            if profile is None:
                profile = FiscalIssuerProfile(tenant_id=tenant_id)
                db.add(profile)
            profile.fiscal_data = issuer.model_dump(mode="json")
            row = _owned(db, tenant_id, token)
            row.issuer_snapshot = issuer.model_dump(mode="json")
            db.commit()
            current = provider.get_organization(row.organization_id)
            values = _validate_organization(current, tenant_id, row.organization_id)
            certificate = current.get("certificate") or {}
            if certificate.get("has_certificate") is True and values[1] and values[1] != issuer.rfc:
                raise ProviderError("provider_issuer_mismatch", definitive=False)
            organization = provider.update_legal(
                row.organization_id,
                issuer,
                name=organization_name(tenant_id),
            )
            _validate_organization(organization, tenant_id, row.organization_id)
            _keys(db, tenant_id, token, provider)
            audit.log(
                db,
                action="fiscal.enrollment_activated",
                tenant_id=tenant_id,
                user_id=user_id,
                resource_type="cfdi_enrollment",
                resource_id=tenant_id,
                changes={"managed": True},
            )
            return _sync(db, tenant_id, token, organization)
        except ProviderError as exc:
            _fail(db, tenant_id, token, exc, creation_attempted=creation_attempted)


def refresh(db: Session, tenant_id: UUID, user_id: UUID):
    row = db.query(CfdiEnrollment).filter_by(tenant_id=tenant_id).first()
    if row is None:
        return status(db, tenant_id)
    # Resume legal/keys as needed; no repeated external organization POST.
    return activate(db, tenant_id, user_id, FiscalIdentity(**row.issuer_snapshot))


def upload_certificate(db, tenant_id, user_id, cer, key, password):
    from app.cfdi.certificates import CsdValidationError, validate_csd

    with _provider() as provider:
        row = db.query(CfdiEnrollment).filter_by(tenant_id=tenant_id).first()
        if row is None or not row.organization_id:
            raise bad_request("Activa primero la facturación de tu negocio")
        try:
            validate_csd(cer, key, password, row.issuer_snapshot["rfc"])
        except CsdValidationError as exc:
            raise bad_request(str(exc)) from None
        row, token, _recover = _claim(db, tenant_id)
        try:
            current = provider.get_organization(row.organization_id)
            _validate_organization(current, tenant_id, row.organization_id)
            organization = provider.upload_certificate(row.organization_id, cer, key, password)
            values = _validate_organization(organization, tenant_id, row.organization_id)
            if values[1] != row.issuer_snapshot["rfc"]:
                raise ProviderError("provider_issuer_mismatch", definitive=False)
            _keys(db, tenant_id, token, provider)
            audit.log(
                db,
                action="fiscal.certificate_uploaded",
                tenant_id=tenant_id,
                user_id=user_id,
                resource_type="cfdi_enrollment",
                resource_id=tenant_id,
                changes={"uploaded": True},
            )
            return _sync(db, tenant_id, token, organization)
        except ProviderError as exc:
            _fail(db, tenant_id, token, exc)
