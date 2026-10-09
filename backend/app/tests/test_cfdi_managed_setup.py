"""Managed fiscal enrollment through real auth/API/Postgres, synthetic provider/CSD."""

import copy
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import Membership, User, UserSession
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.cfdi import credentials, setup
from app.cfdi import service as cfdi_service
from app.cfdi.models import CfdiConnection, CfdiDocument, CfdiEnrollment
from app.cfdi.provider import ProviderError
from app.cfdi.schemas import InvoicePreparation
from app.config import settings
from app.db import set_tenant_context
from app.integrations.models import FiscalIssuerProfile, InvoiceRequest
from app.middleware import rate_limit
from app.tests.test_cfdi_certificates import PASSWORD, certificate, encrypted_key
from app.tests.test_cfdi_lifecycle import FakeProvider
from app.tests.test_fiscal_global_drafts import _product, _sale, _signup_login
from app.tests.test_integrations_readiness import ISSUER, RECIPIENT

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/integrations/cfdi"
REAL_PROVIDER_FACTORY = setup._provider


class ManagedProvider:
    """Retains external state across requests; reproduces ambiguous external writes."""

    def __init__(self):
        self.organizations = {}
        self.calls = []
        self.create_failure = None
        self.legal_failure = None
        self.key_failure = None
        self.hide_search = False
        self.foreign_binding = None
        self.find_failure = None
        self.default_rfc = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def close(self):
        pass

    def create_organization(self, name):
        self.calls.append(("create", name))
        if self.create_failure and self.create_failure.definitive:
            raise self.create_failure
        identifier = "org-" + uuid4().hex
        value = {
            "id": identifier,
            "legal": {"name": name},
            "is_production_ready": False,
            "certificate": {"has_certificate": False},
        }
        if self.default_rfc:
            value["legal"]["tax_id"] = self.default_rfc
        self.organizations[identifier] = value
        if self.create_failure:
            raise self.create_failure
        return copy.deepcopy(value)

    def find_organization(self, name):
        self.calls.append(("find", name))
        if self.find_failure:
            raise self.find_failure
        if self.hide_search:
            return None
        matches = [row for row in self.organizations.values() if row["legal"]["name"] == name]
        if len(matches) > 1:
            raise ProviderError("provider_lookup_ambiguous", definitive=False)
        return copy.deepcopy(matches[0]) if matches else None

    def get_organization(self, identifier):
        self.calls.append(("get", identifier))
        value = copy.deepcopy(self.organizations[identifier])
        if self.foreign_binding:
            value["legal"]["name"] = self.foreign_binding
        return value

    def update_legal(self, identifier, identity, *, name):
        self.calls.append(("legal", identifier))
        if self.legal_failure:
            raise self.legal_failure
        self.organizations[identifier]["legal"].update(
            name=name,
            legal_name=identity.legal_name,
            tax_system=identity.tax_regime,
            address={"zip": identity.postal_code},
        )
        return copy.deepcopy(self.organizations[identifier])

    def test_key(self, identifier):
        self.calls.append(("test-key", identifier))
        if self.key_failure:
            raise self.key_failure
        return "sk_test_synthetic_" + identifier

    def live_key(self, identifier):
        self.calls.append(("live-key", identifier))
        if self.key_failure:
            raise self.key_failure
        return "sk_live_synthetic_" + identifier

    def upload_certificate(self, identifier, cer, key, password):
        # Record no certificate bytes or password in the fake call journal.
        self.calls.append(("certificate", identifier))
        assert cer and key and password == PASSWORD
        value = self.organizations[identifier]
        value["legal"]["tax_id"] = ISSUER["rfc"]
        value["is_production_ready"] = True
        value["certificate"] = {"has_certificate": True, "expires_at": "2035-01-01T00:00:00Z"}
        return copy.deepcopy(value)

    def count(self, operation):
        return sum(call[0] == operation for call in self.calls)


@pytest.fixture
def managed(monkeypatch):
    monkeypatch.setattr(settings, "kova_cfdi_enabled", True)
    monkeypatch.setattr(
        settings, "kova_cfdi_credentials_key", SecretStr(Fernet.generate_key().decode())
    )
    monkeypatch.setattr(settings, "kova_facturapi_user_key", SecretStr("sk_user_synthetic_only"))
    monkeypatch.setattr(rate_limit, "_backend", rate_limit._InMemoryBackend())
    fake = ManagedProvider()
    monkeypatch.setattr(setup, "_provider", lambda: fake)
    return fake


@pytest.fixture(scope="module")
def csd():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(UTC)
    cer = certificate(
        key, rfc=ISSUER["rfc"], before=now - timedelta(days=1), after=now + timedelta(days=365)
    )
    return key, cer, encrypted_key(key)


def activate(client, issuer=None):
    return client.post(f"{BASE}/setup", json={"issuer": issuer or ISSUER})


def upload(client, cer, key, password=PASSWORD):
    return client.post(
        f"{BASE}/setup/certificate",
        files={
            "cer": ("csd.cer", cer, "application/octet-stream"),
            "key": ("csd.key", key, "application/octet-stream"),
        },
        data={"password": password},
    )


def sale_request(client):
    sale = _sale(client, _product(client)["id"])
    response = client.post(
        "/api/v1/integrations/invoice-requests",
        json={"order_id": sale["id"], "recipient": RECIPIENT},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    return sale, response.json()


def document_payload(sale, request, environment="test"):
    return {
        "request_id": request["id"],
        "environment": environment,
        "payment_form": "03",
        "lines": [
            {
                "order_item_id": item["id"],
                "product_key": "50181900",
                "unit_key": "H87",
                "tax_kind": "not_subject",
                "tax_included": False,
            }
            for item in sale["items"]
        ],
    }


def seed_document(db, tenant, sale, request, state="pending", environment="live"):
    connection = db.query(CfdiConnection).filter_by(tenant_id=tenant, environment=environment).one()
    user = db.query(Membership).filter_by(tenant_id=tenant).one().user_id
    frozen = db.get(InvoiceRequest, UUID(request["id"]))
    bind_branch(db, tenant_id=tenant, branch_id=frozen.branch_id)
    payload = document_payload(sale, request, environment)
    identifier = uuid4()
    row = CfdiDocument(
        id=identifier,
        tenant_id=tenant,
        branch_id=frozen.branch_id,
        order_id=UUID(sale["id"]),
        request_id=frozen.id,
        connection_id=connection.id,
        environment=environment,
        organization_id=connection.organization_id,
        state=state,
        idempotency_key="seed-" + identifier.hex,
        request_hash=cfdi_service.fingerprint(
            InvoicePreparation(**payload).model_dump(mode="json")
        ),
        external_id="seed-external-" + identifier.hex,
        provider_key="seed-provider-" + identifier.hex,
        total_amount=frozen.total_amount,
        created_by_user_id=user,
        payload={
            "customer": {
                "tax_id": RECIPIENT["rfc"],
                "legal_name": RECIPIENT["legal_name"],
                "tax_system": RECIPIENT["tax_regime"],
                "address": {"zip": RECIPIENT["postal_code"]},
                "email": RECIPIENT["email"],
            },
            "use": RECIPIENT["cfdi_use"],
            "items": [],
        },
    )
    db.add(row)
    db.commit()
    return row, payload


@pytest.mark.parametrize(
    "state", ["prepared", "submitting", "unknown", "pending", "cancel_pending", "integrity_error"]
)
def test_unresolved_live_document_blocks_setup_and_certificate_before_provider_mutations(
    client, db, managed, csd, state
):
    tenant = _signup_login(client, prefix="unresolved-document")
    assert activate(client).status_code == 200
    sale, request = sale_request(client)
    row, _payload = seed_document(db, tenant, sale, request, state)
    calls = len(managed.calls)
    assert client.post(f"{BASE}/setup/refresh").status_code == 409
    assert activate(client).status_code == 409
    assert upload(client, csd[1], csd[2]).status_code == 409
    assert len(managed.calls) == calls
    assert row.state == state and db.get(CfdiEnrollment, tenant).operation_id is None


@pytest.mark.parametrize("state", ["issued", "canceled", "rejected"])
def test_resolved_live_document_allows_setup_refresh_preserving_history(client, db, managed, state):
    tenant = _signup_login(client, prefix="resolved-document")
    assert activate(client).status_code == 200
    sale, request = sale_request(client)
    row, _payload = seed_document(db, tenant, sale, request, state)
    assert client.post(f"{BASE}/setup/refresh").status_code == 200
    assert row.state == state and managed.count("create") == 1


def test_unresolved_live_document_in_other_branch_blocks_tenant_setup(client, db, managed):
    from app.branches.models import Branch

    tenant = _signup_login(client, prefix="cross-branch-document")
    assert activate(client).status_code == 200
    branch = Branch(tenant_id=tenant, name="Otra sucursal fiscal")
    db.add(branch)
    db.commit()
    client.headers["X-Kova-Branch"] = str(branch.id)
    try:
        sale, request = sale_request(client)
        row, _payload = seed_document(db, tenant, sale, request)
        assert row.branch_id == branch.id
    finally:
        client.headers.pop("X-Kova-Branch", None)
    calls = len(managed.calls)
    assert client.post(f"{BASE}/setup/refresh").status_code == 409
    assert len(managed.calls) == calls


def test_busy_setup_blocks_new_document_before_reservation_or_provider_post(
    client, db, managed, monkeypatch
):
    tenant = _signup_login(client, prefix="busy-setup-document")
    assert activate(client).status_code == 200
    sale, request = sale_request(client)
    enrollment = db.get(CfdiEnrollment, tenant)
    enrollment.operation_id = uuid4()
    enrollment.updated_at = datetime.now(UTC)
    db.commit()
    invoice_provider = FakeProvider(db)
    monkeypatch.setattr(cfdi_service, "_provider", lambda _connection: invoice_provider)
    response = client.post(
        f"{BASE}/documents",
        json=document_payload(sale, request),
        headers={"Idempotency-Key": "blocked-while-setup-busy"},
    )
    assert response.status_code == 409, response.text
    assert (
        invoice_provider.posts == 0
        and db.query(CfdiDocument).filter_by(tenant_id=tenant).count() == 0
    )


def test_busy_setup_preserves_existing_document_replay_without_provider_post(
    client, db, managed, monkeypatch
):
    tenant = _signup_login(client, prefix="busy-setup-replay")
    assert activate(client).status_code == 200
    sale, request = sale_request(client)
    document, payload = seed_document(db, tenant, sale, request, environment="test")
    enrollment = db.get(CfdiEnrollment, tenant)
    enrollment.operation_id = uuid4()
    enrollment.updated_at = datetime.now(UTC)
    db.commit()
    invoice_provider = FakeProvider(db)
    monkeypatch.setattr(cfdi_service, "_provider", lambda _connection: invoice_provider)
    response = client.post(
        f"{BASE}/documents", json=payload, headers={"Idempotency-Key": document.idempotency_key}
    )
    assert response.status_code == 201, response.text
    assert response.json()["id"] == str(document.id)
    assert invoice_provider.posts == 0


def test_activation_persists_scoped_encrypted_keys_and_replay_never_duplicates(client, db, managed):
    tenant = _signup_login(client, prefix="managed")
    initial = client.get(f"{BASE}/setup")
    assert initial.status_code == 200 and initial.json()["state"] == "not_started"
    response = activate(client)
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "configured"
    assert response.json()["test_connected"] and response.json()["live_connected"]
    assert response.json()["production_ready"] is False
    assert response.json()["manifest_url"] == setup.MANIFEST_URL
    row = db.get(CfdiEnrollment, tenant)
    assert row.organization_id and row.issuer_snapshot == ISSUER
    assert row.operation_id is None and row.last_error_code is None
    created_at = row.created_at
    connections = db.query(CfdiConnection).filter_by(tenant_id=tenant).all()
    ids = {item.environment: item.id for item in connections}
    for connection in connections:
        key = credentials.decrypt_key(
            tenant_id=tenant,
            environment=connection.environment,
            organization_id=row.organization_id,
            encrypted_key=connection.encrypted_api_key,
        )
        assert key == f"sk_{connection.environment}_synthetic_{row.organization_id}"
        assert "sk_" not in connection.encrypted_api_key and key not in response.text
        with pytest.raises(credentials.CredentialStorageUnavailable):
            credentials.decrypt_key(
                tenant_id=uuid4(),
                environment=connection.environment,
                organization_id=row.organization_id,
                encrypted_key=connection.encrypted_api_key,
            )
    assert activate(client).status_code == 200
    assert client.post(f"{BASE}/setup/refresh").status_code == 200
    assert managed.count("create") == managed.count("live-key") == managed.count("test-key") == 1
    assert row.created_at == created_at
    assert ids == {
        item.environment: item.id for item in db.query(CfdiConnection).filter_by(tenant_id=tenant)
    }
    logs = db.query(AuditLog).filter_by(tenant_id=tenant).all()
    assert any(item.action == "fiscal.enrollment_activated" for item in logs)
    assert "sk_" not in json.dumps([item.changes for item in logs])


def test_timeout_creation_recovers_same_external_organization_without_second_post(
    client, db, managed
):
    tenant = _signup_login(client, prefix="unknown-create")
    managed.create_failure = ProviderError("provider_timeout", definitive=False, transient=True)
    assert activate(client).status_code == 400
    row = db.get(CfdiEnrollment, tenant)
    assert row.state == "unknown" and row.organization_id is None and row.operation_id is None
    managed.create_failure = None
    recovered = client.post(f"{BASE}/setup/refresh")
    assert recovered.status_code == 200, recovered.text
    assert row.organization_id == next(iter(managed.organizations))
    assert managed.count("create") == managed.count("find") == 1


def test_unresolved_creation_stays_unknown_and_never_reposts(client, db, managed):
    tenant = _signup_login(client, prefix="unresolved")
    managed.create_failure = ProviderError("provider_timeout", definitive=False)
    assert activate(client).status_code == 400
    managed.create_failure = None
    managed.hide_search = True
    assert client.post(f"{BASE}/setup/refresh").status_code == 400
    assert activate(client).status_code == 400
    row = db.get(CfdiEnrollment, tenant)
    assert row.state == "unknown" and row.last_error_code == "provider_creation_unresolved"
    assert row.operation_id is None and managed.count("create") == 1
    assert managed.count("find") == 2 and managed.count("live-key") == 0


def test_lookup_auth_error_after_uncertain_creation_never_allows_new_post(client, db, managed):
    tenant = _signup_login(client, prefix="uncertain-auth")
    managed.create_failure = ProviderError("provider_timeout", definitive=False)
    assert activate(client).status_code == 400
    managed.create_failure = None
    managed.find_failure = ProviderError("provider_authentication_failed", status_code=401)
    assert client.post(f"{BASE}/setup/refresh").status_code == 400
    row = db.get(CfdiEnrollment, tenant)
    assert row.state == "unknown" and row.creation_rejected is False
    managed.find_failure = None
    assert client.post(f"{BASE}/setup/refresh").status_code == 200
    assert managed.count("create") == 1 and managed.count("find") == 2


def test_interrupted_creation_lease_recovers_remote_marker_without_repost(client, db, managed):
    tenant = _signup_login(client, prefix="interrupted-create")
    organization = managed.create_organization(setup.organization_name(tenant))
    db.add(
        CfdiEnrollment(
            tenant_id=tenant,
            issuer_snapshot=ISSUER,
            state="creating",
            operation_id=uuid4(),
            updated_at=datetime.now(UTC) - setup.OPERATION_LEASE - timedelta(seconds=1),
        )
    )
    db.commit()
    assert client.post(f"{BASE}/setup/refresh").status_code == 200
    assert db.get(CfdiEnrollment, tenant).organization_id == organization["id"]
    assert managed.count("create") == managed.count("find") == 1


def test_definitive_creation_failure_allows_new_attempt(client, db, managed):
    tenant = _signup_login(client, prefix="definitive")
    managed.create_failure = ProviderError("provider_authentication_failed", status_code=401)
    assert activate(client).status_code == 400
    assert db.get(CfdiEnrollment, tenant).state == "error"
    managed.create_failure = None
    assert activate(client).status_code == 200
    assert managed.count("create") == 2 and managed.count("find") == 0


@pytest.mark.parametrize("failure_step", ["legal", "keys"])
def test_timeout_after_organization_checkpoint_never_recreates_organization(
    client, db, managed, failure_step
):
    tenant = _signup_login(client, prefix="checkpoint")
    error = ProviderError("provider_timeout", definitive=False)
    if failure_step == "legal":
        managed.legal_failure = error
    else:
        managed.key_failure = error
    assert activate(client).status_code == 400
    row = db.get(CfdiEnrollment, tenant)
    organization_id = row.organization_id
    assert organization_id and row.state == "error"
    assert client.post(f"{BASE}/setup/refresh").status_code == 400
    assert row.organization_id == organization_id and managed.count("create") == 1
    managed.legal_failure = managed.key_failure = None
    assert client.post(f"{BASE}/setup/refresh").status_code == 200
    assert managed.count("create") == 1


def test_busy_lease_blocks_and_expired_lease_reconciles_existing_marker(client, db, managed):
    tenant = _signup_login(client, prefix="lease")
    assert activate(client).status_code == 200
    row = db.get(CfdiEnrollment, tenant)
    row.operation_id = uuid4()
    row.updated_at = datetime.now(UTC)
    db.commit()
    calls = len(managed.calls)
    assert client.post(f"{BASE}/setup/refresh").status_code == 409
    assert len(managed.calls) == calls
    row.updated_at = datetime.now(UTC) - setup.OPERATION_LEASE - timedelta(seconds=1)
    db.commit()
    assert client.post(f"{BASE}/setup/refresh").status_code == 200
    assert managed.count("create") == 1


def test_two_tenants_get_distinct_bindings_and_keys(client, db, managed):
    first = _signup_login(client, prefix="first")
    assert activate(client).status_code == 200
    first_row = db.get(CfdiEnrollment, first)
    second = _signup_login(client, prefix="second")
    assert client.get(f"{BASE}/setup").json()["state"] == "not_started"
    assert activate(client).status_code == 200
    second_row = db.get(CfdiEnrollment, second)
    assert first_row.organization_id != second_row.organization_id
    assert managed.organizations[first_row.organization_id]["legal"][
        "name"
    ] == setup.organization_name(first)
    assert managed.organizations[second_row.organization_id]["legal"][
        "name"
    ] == setup.organization_name(second)
    assert db.query(CfdiConnection).filter_by(tenant_id=first).count() == 2
    assert db.query(CfdiConnection).filter_by(tenant_id=second).count() == 2


def test_legacy_connection_cannot_be_silently_adopted(client, db, managed):
    tenant = _signup_login(client, prefix="legacy")
    connection = CfdiConnection(
        tenant_id=tenant,
        environment="test",
        organization_id="legacy-org",
        encrypted_api_key=credentials.encrypt_key(
            tenant_id=tenant,
            environment="test",
            organization_id="legacy-org",
            api_key="sk_test_synthetic_legacy",
        ),
    )
    db.add(connection)
    db.commit()
    assert client.get(f"{BASE}/setup").json()["state"] == "legacy"
    assert activate(client).status_code == 409
    assert not managed.calls and db.get(CfdiEnrollment, tenant) is None
    assert connection.organization_id == "legacy-org"


@pytest.mark.parametrize("role", ["manager", "cashier"])
def test_nonowners_cannot_activate_refresh_or_upload(client, db, managed, role):
    tenant = _signup_login(client, prefix=role)
    db.query(Membership).filter_by(tenant_id=tenant).one().role = role
    db.commit()
    assert client.get(f"{BASE}/setup").status_code == 403
    assert activate(client).status_code == 403
    assert client.post(f"{BASE}/setup/refresh").status_code == 403
    assert upload(client, b"fake-cer", b"fake-key").status_code == 403
    assert not managed.calls


def test_unpaid_and_csrf_rejected_before_provider(client, db, managed):
    tenant = _signup_login(client, prefix="billing")
    assert (
        client.post(
            f"{BASE}/setup", json={"issuer": ISSUER}, headers={"x-csrf-token": "invalid"}
        ).status_code
        == 403
    )
    subscription = Subscription(
        tenant_id=tenant,
        status="unpaid",
        trial_ends_at=datetime.now(UTC) - timedelta(days=1),
    )
    db.add(subscription)
    db.commit()
    assert activate(client).status_code == 402
    assert client.post(f"{BASE}/setup/refresh").status_code == 402
    assert upload(client, b"cer", b"key").status_code == 402
    assert not managed.calls


def test_manual_connection_and_rfc_replacement_blocked_after_managed_activation(
    client, db, managed
):
    tenant = _signup_login(client, prefix="managed-binding")
    assert activate(client).status_code == 200
    assert (
        client.put(
            f"{BASE}/connection",
            json={"environment": "test", "api_key": "sk_test_synthetic_replacement"},
        ).status_code
        == 409
    )
    other = {**ISSUER, "rfc": "AAA010101AAA"}
    assert activate(client, other).status_code == 409
    assert client.put("/api/v1/integrations/issuer", json=other).status_code == 409
    assert db.get(CfdiEnrollment, tenant).issuer_snapshot == ISSUER


def test_provider_default_rfc_before_csd_allows_setup_without_live_readiness(client, db, managed):
    tenant = _signup_login(client, prefix="default-provider-rfc")
    managed.default_rfc = "AAA010101AAA"
    response = activate(client)
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "configured"
    assert response.json()["test_connected"] and response.json()["live_connected"]
    assert response.json()["production_ready"] is False
    row = db.get(CfdiEnrollment, tenant)
    organization = managed.organizations[row.organization_id]
    assert organization["legal"]["tax_id"] != ISSUER["rfc"]
    assert organization["certificate"]["has_certificate"] is False
    assert managed.count("create") == managed.count("test-key") == managed.count("live-key") == 1


def test_provider_certified_foreign_rfc_rejected_before_legal_mutation(client, db, managed):
    tenant = _signup_login(client, prefix="foreign-certified-rfc")
    assert activate(client).status_code == 200
    row = db.get(CfdiEnrollment, tenant)
    organization = managed.organizations[row.organization_id]
    organization["legal"]["tax_id"] = "AAA010101AAA"
    organization.update(
        is_production_ready=True,
        certificate={"has_certificate": True, "expires_at": "2035-01-01T00:00:00Z"},
    )
    before = copy.deepcopy(organization)
    legal_calls = managed.count("legal")
    response = client.post(f"{BASE}/setup/refresh")
    assert response.status_code == 400, response.text
    assert row.last_error_code == "provider_issuer_mismatch"
    assert managed.count("legal") == legal_calls
    assert managed.count("create") == 1
    assert organization == before
    assert row.issuer_snapshot == ISSUER


def test_identical_issuer_put_preserves_certified_readiness_without_provider_calls(
    client, db, managed, csd
):
    tenant = _signup_login(client, prefix="identical-issuer")
    assert activate(client).status_code == 200
    assert upload(client, csd[1], csd[2]).json()["production_ready"] is True
    before_calls = len(managed.calls)
    audit_count = (
        db.query(AuditLog).filter_by(tenant_id=tenant, action="fiscal.issuer_updated").count()
    )
    response = client.put("/api/v1/integrations/issuer", json=ISSUER)
    assert response.status_code == 200 and response.json()["can_issue_cfdi"] is True
    assert client.get(f"{BASE}/setup").json()["production_ready"] is True
    assert len(managed.calls) == before_calls
    assert (
        db.query(AuditLog).filter_by(tenant_id=tenant, action="fiscal.issuer_updated").count()
        == audit_count
    )


def test_legal_edit_invalidates_readiness_preserves_historical_request_and_refreshes(
    client, db, managed
):
    tenant = _signup_login(client, prefix="legal-history")
    assert activate(client).status_code == 200
    sale = _sale(client, _product(client)["id"])
    response = client.post(
        "/api/v1/integrations/invoice-requests",
        json={"order_id": sale["id"], "recipient": RECIPIENT},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    historical = db.get(InvoiceRequest, UUID(response.json()["id"]))
    row = db.get(CfdiEnrollment, tenant)
    created_at = row.created_at
    managed.organizations[row.organization_id]["legal"]["tax_id"] = ISSUER["rfc"]
    managed.organizations[row.organization_id].update(
        is_production_ready=True,
        certificate={"has_certificate": True, "expires_at": "2035-01-01T00:00:00Z"},
    )
    assert client.post(f"{BASE}/setup/refresh").json()["production_ready"] is True
    updated = {**ISSUER, "legal_name": "Negocio actualizado", "postal_code": "01000"}
    saved = client.put("/api/v1/integrations/issuer", json=updated)
    assert saved.status_code == 200 and saved.json()["can_issue_cfdi"] is False
    assert row.issuer_snapshot == updated
    assert historical.issuer_snapshot == ISSUER and row.created_at == created_at
    assert client.get(f"{BASE}/setup").json()["production_ready"] is False
    assert client.post(f"{BASE}/setup/refresh").json()["production_ready"] is True
    assert managed.count("create") == managed.count("live-key") == 1


def test_validated_csd_upload_enables_live_without_persisting_material(
    client, db, managed, csd, caplog
):
    tenant = _signup_login(client, prefix="certificate")
    assert activate(client).status_code == 200
    _, cer, key = csd
    response = upload(client, cer, key)
    assert response.status_code == 200, response.text
    assert response.json()["production_ready"] is True
    assert managed.count("certificate") == 1
    assert client.get("/api/v1/integrations/readiness").json()["can_issue_cfdi"] is True
    enrollment = db.get(CfdiEnrollment, tenant)
    profile = db.query(FiscalIssuerProfile).filter_by(tenant_id=tenant).one()
    logs = db.query(AuditLog).filter_by(tenant_id=tenant).all()
    persisted = json.dumps(
        [enrollment.issuer_snapshot, profile.fiscal_data, [item.changes for item in logs]]
    )
    assert PASSWORD not in response.text + persisted + caplog.text
    assert str(cer) not in response.text + persisted + caplog.text
    assert str(key) not in response.text + persisted + caplog.text
    assert "sk_" not in response.text + persisted + caplog.text
    assert managed.count("live-key") == 1


@pytest.mark.parametrize("problem", ["wrong-rfc", "wrong-password", "expired", "efirma"])
def test_invalid_csd_never_uploaded_or_changes_binding(client, db, managed, csd, problem):
    tenant = _signup_login(client, prefix="invalid-csd")
    assert activate(client).status_code == 200
    private, cer, key = csd
    password = PASSWORD
    if problem == "wrong-rfc":
        cer = certificate(private, rfc="AAA010101AAA")
    elif problem == "wrong-password":
        password = "wrong-synthetic-password"
    elif problem == "expired":
        cer = certificate(
            private, rfc=ISSUER["rfc"], after=datetime.now(UTC) - timedelta(seconds=1)
        )
    else:
        cer = certificate(private, rfc=ISSUER["rfc"], usage="fiel")
    calls = len(managed.calls)
    response = upload(client, cer, key, password)
    assert response.status_code == 400, response.text
    assert len(managed.calls) == calls
    assert db.get(CfdiEnrollment, tenant).state == "configured"
    assert client.get(f"{BASE}/setup").json()["production_ready"] is False
    assert password not in response.text


def test_provider_foreign_binding_prevents_valid_certificate_upload(client, db, managed, csd):
    tenant = _signup_login(client, prefix="binding-check")
    assert activate(client).status_code == 200
    managed.foreign_binding = setup.organization_name(uuid4())
    response = upload(client, csd[1], csd[2])
    assert response.status_code == 400
    assert managed.count("certificate") == 0
    assert (
        db.get(CfdiEnrollment, tenant).last_error_code == "provider_organization_binding_mismatch"
    )


def test_stale_session_prevents_certificate_upload(client, db, managed, csd):
    tenant = _signup_login(client, prefix="revoked-session")
    assert activate(client).status_code == 200
    user = db.query(Membership).filter_by(tenant_id=tenant).one().user_id
    for session in db.query(UserSession).filter_by(user_id=user):
        session.revoked_at = datetime.now(UTC)
    db.commit()
    assert upload(client, csd[1], csd[2]).status_code == 401
    assert managed.count("certificate") == 0


def test_invalid_legal_length_and_extra_fields_are_private_and_never_dispatched(
    client, db, managed
):
    tenant = _signup_login(client, prefix="invalid-profile")
    assert activate(client, {**ISSUER, "legal_name": "x" * 101}).status_code == 400
    response = client.post(
        f"{BASE}/setup", json={"issuer": ISSUER, "api_key": "sk_user_secret_echo_test"}
    )
    assert response.status_code == 422 and "secret_echo" not in response.text
    assert db.get(CfdiEnrollment, tenant) is None and not managed.calls


def test_missing_platform_credential_disables_activation_without_journaling(
    client, db, managed, monkeypatch
):
    tenant = _signup_login(client, prefix="not-configured")
    monkeypatch.setattr(settings, "kova_facturapi_user_key", None)
    monkeypatch.setattr(setup, "_provider", REAL_PROVIDER_FACTORY)
    assert client.get(f"{BASE}/setup").json()["available"] is False
    response = activate(client)
    assert response.status_code == 400
    assert db.get(CfdiEnrollment, tenant) is None and not managed.calls


@pytest.fixture
def committed_enrollments(owner_engine):
    tenants = [uuid4(), uuid4(), uuid4()]
    with Session(owner_engine) as db:
        from app.tenants.models import Tenant

        db.add_all(
            [
                Tenant(
                    id=identifier, name="Synthetic managed RLS", slug="managed-" + identifier.hex
                )
                for identifier in tenants
            ]
        )
        db.flush()
        db.add_all(
            [
                CfdiEnrollment(
                    tenant_id=identifier,
                    organization_id="rls-org-" + identifier.hex,
                    issuer_snapshot=ISSUER,
                    state="configured",
                )
                for identifier in tenants[:2]
            ]
        )
        db.commit()
    yield tenants
    with owner_engine.begin() as connection:
        for identifier in tenants:
            for table in (
                "audit_logs",
                "cfdi_connections",
                "fiscal_issuer_profiles",
                "cfdi_enrollments",
            ):
                connection.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id=:tenant"), {"tenant": identifier}
                )
            connection.execute(text("DELETE FROM tenants WHERE id=:tenant"), {"tenant": identifier})


def test_rls_enrollment_has_no_context_visibility_or_cross_tenant_writes(
    kova_app_engine, committed_enrollments
):
    first, second, third = committed_enrollments
    with kova_app_engine.connect() as connection:
        assert connection.execute(text("SELECT tenant_id FROM cfdi_enrollments")).all() == []
        connection.rollback()
        connection.execute(
            text("SELECT set_config('app.tenant_id', :tenant, true)"), {"tenant": str(first)}
        )
        assert connection.execute(
            text("SELECT tenant_id FROM cfdi_enrollments")
        ).scalars().all() == [first]
        assert (
            connection.execute(
                text("UPDATE cfdi_enrollments SET state='error' WHERE tenant_id=:tenant"),
                {"tenant": second},
            ).rowcount
            == 0
        )
        with pytest.raises(DBAPIError) as error:
            connection.execute(
                text(
                    "INSERT INTO cfdi_enrollments (tenant_id, issuer_snapshot, state) VALUES (:tenant, '{}'::json, 'creating')"
                ),
                {"tenant": third},
            )
        assert error.value.orig.sqlstate == "42501"
        connection.rollback()


def test_unique_organization_binding_cannot_be_assigned_to_other_tenant(
    owner_engine, committed_enrollments
):
    first, _second, third = committed_enrollments
    with Session(owner_engine) as db:
        db.add(
            CfdiEnrollment(
                tenant_id=third,
                organization_id="rls-org-" + first.hex,
                issuer_snapshot=ISSUER,
                state="configured",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_managed_service_runs_under_rls_role_across_checkpoint_commits(
    kova_app_engine, owner_engine, committed_enrollments, managed
):
    _first, _second, tenant = committed_enrollments
    from app.integrations.schemas import FiscalIdentity

    user_id = uuid4()
    with Session(owner_engine) as owner:
        owner.add(
            User(
                id=user_id,
                email=f"managed-rls-{user_id.hex}@example.com",
                hashed_password="synthetic-unused-hash",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        owner.commit()
    try:
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            result = setup.activate(db, tenant, user_id, FiscalIdentity(**ISSUER))
            assert result.state == "configured" and result.test_connected and result.live_connected
            assert db.query(CfdiEnrollment).count() == 1
            assert db.query(CfdiConnection).count() == 2
            assert setup.refresh(db, tenant, user_id).state == "configured"
            assert managed.count("create") == managed.count("live-key") == 1
    finally:
        with owner_engine.begin() as owner:
            owner.execute(text("DELETE FROM audit_logs WHERE user_id=:user"), {"user": user_id})
            owner.execute(text("DELETE FROM users WHERE id=:user"), {"user": user_id})
