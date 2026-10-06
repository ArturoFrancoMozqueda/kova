import csv
import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.account_lifecycle.models import AccountDeletionRequest
from app.account_lifecycle.service import purge_due_accounts
from app.auth.models import User
from app.cfdi.models import CfdiConnection, CfdiDocument
from app.integrations.models import InvoiceRequest
from app.orders.models import Order
from app.tenants.models import Tenant
from app.tests.test_integrations_readiness import ISSUER, RECIPIENT
from app.tests.test_orders import _create_product, _signup_verify_login


def seed_cfdi_graph(client: TestClient, db: Session, label: str):
    """Persist test documents for portability tests; no provider is contacted."""
    email = f"cfdi-account-{label}-{uuid4().hex}@example.com"
    account = _signup_verify_login(client, email, f"CFDI account {label}")
    product = _create_product(client, name=f"Producto {label}", price="100.00")
    sale = client.post(
        "/api/v1/orders",
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [{"method": "bank_transfer", "amount": "100.00"}],
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert sale.status_code == 201, sale.text
    issuer = client.put("/api/v1/integrations/issuer", json=ISSUER)
    assert issuer.status_code == 200, issuer.text
    request = client.post(
        "/api/v1/integrations/invoice-requests",
        json={"order_id": sale.json()["id"], "recipient": RECIPIENT},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert request.status_code == 201, request.text
    tenant_id = UUID(account["tenant_id"])
    user = db.scalar(select(User).where(User.email == email))
    # Fresh ephemeral encryption proves ciphertext is retained at rest but
    # omitted from portability; this is deliberately not a production API key.
    test_plaintext = f"test-fixture-only-{label}-{uuid4()}".encode()
    cipher = Fernet(Fernet.generate_key()).encrypt(test_plaintext).decode()
    connection = CfdiConnection(
        tenant_id=tenant_id,
        environment="test",
        organization_id=f"org-test-{label}",
        encrypted_api_key=cipher,
        issuer_rfc=ISSUER["rfc"],
        production_ready=False,
    )
    db.add(connection)
    db.flush()
    document_id = uuid4()
    fiscal_uuid = uuid4()
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" '
        'xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" '
        f'Total="100.00" Moneda="MXN" Serie="TEST-{label}">'
        f'<cfdi:Emisor Rfc="{ISSUER["rfc"]}" />'
        f'<cfdi:Receptor Rfc="{RECIPIENT["rfc"]}" />'
        f'<cfdi:Complemento><tfd:TimbreFiscalDigital UUID="{fiscal_uuid}" />'
        "</cfdi:Complemento></cfdi:Comprobante>"
    ).encode()
    document = CfdiDocument(
        id=document_id,
        tenant_id=tenant_id,
        order_id=UUID(sale.json()["id"]),
        request_id=UUID(request.json()["id"]),
        connection_id=connection.id,
        environment="test",
        organization_id=connection.organization_id,
        state="issued",
        idempotency_key=str(uuid4()),
        request_hash="a" * 64,
        external_id=f"kova-test-account-{document_id}",
        provider_key=f"kova-test-key-{document_id}",
        provider_id=f"test-document-{document_id}",
        uuid=fiscal_uuid,
        payload={
            "customer": {"tax_id": RECIPIENT["rfc"], "legal_name": RECIPIENT["legal_name"]},
            "items": [],
        },
        total_amount=Decimal("100.00"),
        xml_bytes=xml,
        created_by_user_id=user.id,
    )
    db.add(document)
    db.commit()
    return {
        "tenant_id": tenant_id,
        "user_id": user.id,
        "email": email,
        "order_id": UUID(sale.json()["id"]),
        "request_id": UUID(request.json()["id"]),
        "connection_id": connection.id,
        "document_id": document_id,
        "cipher": cipher,
        "plaintext": test_plaintext,
        "xml": xml,
    }


def test_export_includes_own_cfdi_metadata_and_xml_without_credentials_or_foreign_data(client, db):
    own = seed_cfdi_graph(client, db, "own")
    other_client = TestClient(client.app)
    other = seed_cfdi_graph(other_client, db, "foreign")
    response = client.get("/api/v1/export/account")
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"].split(", ")
    assert response.headers["x-content-type-options"] == "nosniff"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["fiscal_xml_files"] == 1
        xml_path = f"cfdi/test/{own['document_id']}.xml"
        assert archive.read(xml_path) == own["xml"]
        assert f"cfdi/test/{other['document_id']}.xml" not in archive.namelist()
        connections = list(
            csv.DictReader(io.StringIO(archive.read("datos/cfdi_connections.csv").decode()))
        )
        assert [row["id"] for row in connections] == [str(own["connection_id"])]
        assert "encrypted_api_key" not in connections[0]
        documents = list(
            csv.DictReader(io.StringIO(archive.read("datos/cfdi_documents.csv").decode()))
        )
        assert [row["id"] for row in documents] == [str(own["document_id"])]
        assert documents[0]["state"] == "issued" and documents[0]["environment"] == "test"
        assert "xml_bytes" not in documents[0]  # XML is an actual file, not a CSV placeholder.
        assert "provider_key" not in documents[0] and "idempotency_key" not in documents[0]
        every_file = b"\n".join(archive.read(name) for name in archive.namelist())
        for secret in (
            own["cipher"].encode(),
            own["plaintext"],
            other["cipher"].encode(),
            other["plaintext"],
        ):
            assert secret not in every_file
        assert str(other["document_id"]).encode() not in every_file
        assert other["xml"] not in every_file
        assert "no cancela un CFDI ante el SAT" in every_file.decode()


def test_due_account_purge_removes_cfdi_ciphertext_xml_and_dependencies_only_for_requested_tenant(
    client, db
):
    own = seed_cfdi_graph(client, db, "delete")
    other_client = TestClient(client.app)
    other = seed_cfdi_graph(other_client, db, "keep")
    # The ORM session is scoped to the last HTTP request; purge is privileged
    # tenant-wide SQL, matching the production internal deletion job.
    request = AccountDeletionRequest(
        tenant_id=own["tenant_id"],
        requested_by_user_id=own["user_id"],
        purge_after=datetime.now(UTC) - timedelta(minutes=1),
    )
    db.add(request)
    db.commit()
    assert purge_due_accounts(db) == 1
    for model, key in (
        (CfdiDocument, "document_id"),
        (CfdiConnection, "connection_id"),
        (InvoiceRequest, "request_id"),
        (Order, "order_id"),
        (Tenant, "tenant_id"),
        (User, "user_id"),
    ):
        assert db.get(model, own[key]) is None
    kept = db.get(CfdiDocument, other["document_id"])
    assert kept is not None and kept.xml_bytes == other["xml"]
    assert db.get(CfdiConnection, other["connection_id"]).encrypted_api_key == other["cipher"]
    assert db.get(InvoiceRequest, other["request_id"]) is not None
    assert db.get(Tenant, other["tenant_id"]) is not None
    assert db.get(User, other["user_id"]) is not None
    db.refresh(request)
    assert request.status == "completed" and request.requested_by_user_id is None
