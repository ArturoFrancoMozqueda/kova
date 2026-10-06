from decimal import Decimal
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy.orm import Session

from app.cfdi import service
from app.cfdi.models import CfdiConnection, CfdiDocument
from app.cfdi.provider import FacturapiProvider, ProviderError
from app.config import settings
from app.fiscal.models import FiscalIndividualInvoiceEvent
from app.tests.test_integrations_readiness import ISSUER, RECIPIENT
from app.tests.test_orders import _create_product, _signup_verify_login

BASE = "/api/v1/integrations/cfdi"


class FakeProvider:
    def __init__(self, db):
        self.db = db
        self.environment = "test"
        self.invoices = {}
        self.posts = 0
        self.cancels = 0
        self.initial_state = "valid"
        self.raise_create = None
        self.xml_total = None
        self.foreign_environment = False
        self.cancel_accepted = False
        self.external = None

    def organization(self):
        return {
            "id": "org-kova",
            "legal": {
                "tax_id": ISSUER["rfc"],
                "legal_name": ISSUER["legal_name"],
                "tax_system": ISSUER["tax_regime"],
                "address": {"zip": ISSUER["postal_code"]},
            },
            "is_production_ready": True,
            "certificate": {"has_certificate": True, "expires_at": "2035-01-01T00:00:00Z"},
        }

    def create_invoice(self, payload, idempotency_key):
        self.posts += 1
        self.external = payload["external_id"]
        # A separate transaction sees the reservation before the external POST.
        with Session(self.db.get_bind()) as independent:
            row = independent.query(CfdiDocument).filter_by(external_id=self.external).one()
            assert row.state == "submitting"
            assert row.provider_key == idempotency_key
        if self.raise_create:
            raise self.raise_create
        response = {
            "id": "inv-" + str(row.id),
            "uuid": str(uuid4()),
            "status": self.initial_state,
            "livemode": self.environment == "live",
            "external_id": self.external,
            "total": Decimal(row.total_amount),
            "cancellation_status": "none",
        }
        self.invoices[response["id"]] = response
        return response

    def get_invoice(self, identifier):
        response = dict(self.invoices[identifier])
        if self.foreign_environment:
            response["livemode"] = not response["livemode"]
        return response

    def find_invoice(self, external_id):
        return next(
            (row for row in self.invoices.values() if row["external_id"] == external_id), None
        )

    def download_xml(self, identifier):
        invoice = self.invoices[identifier]
        total = self.xml_total or invoice["total"]
        from xml.etree import ElementTree as ET

        from app.cfdi import pricing
        from app.pricing.calculator import money

        row = self.db.query(CfdiDocument).filter_by(external_id=invoice["external_id"]).one()
        frozen = row.recipient_snapshot
        c = "http://www.sat.gob.mx/cfd/4"
        t = "http://www.sat.gob.mx/TimbreFiscalDigital"
        root = ET.Element(
            f"{{{c}}}Comprobante",
            Version="4.0",
            TipoDeComprobante="I",
            Moneda="MXN",
            MetodoPago="PUE",
            FormaPago="03",
            Total=str(total),
            LugarExpedicion=ISSUER["postal_code"],
        )
        ET.SubElement(
            root,
            f"{{{c}}}Emisor",
            Rfc=ISSUER["rfc"],
            Nombre=ISSUER["legal_name"],
            RegimenFiscal=ISSUER["tax_regime"],
        )
        ET.SubElement(
            root,
            f"{{{c}}}Receptor",
            Rfc=frozen["rfc"],
            Nombre=frozen["legal_name"],
            RegimenFiscalReceptor=frozen["tax_regime"],
            DomicilioFiscalReceptor=frozen["postal_code"],
            UsoCFDI=frozen["cfdi_use"],
        )
        concepts = ET.SubElement(root, f"{{{c}}}Conceptos")
        gross_sum, discount_sum, tax_sum = Decimal(0), Decimal(0), Decimal(0)
        for expected in service._wire_payload(row.payload)["items"]:
            product = expected["product"]
            gross = pricing.six(product["price"] * expected["quantity"])
            discount = expected["discount"]
            net = pricing.six(gross - discount)
            concept = ET.SubElement(
                concepts,
                f"{{{c}}}Concepto",
                ClaveProdServ=product["product_key"],
                ClaveUnidad=product["unit_key"],
                ObjetoImp=product["taxability"],
                Cantidad=str(expected["quantity"]),
                ValorUnitario=str(product["price"]),
                Importe=str(gross),
                Descuento=str(discount),
                Descripcion=product["description"],
            )
            if product["taxes"]:
                transfers = ET.SubElement(
                    ET.SubElement(concept, f"{{{c}}}Impuestos"), f"{{{c}}}Traslados"
                )
                for tax in product["taxes"]:
                    transfer = ET.SubElement(
                        transfers,
                        f"{{{c}}}Traslado",
                        Base=str(net),
                        Impuesto="002",
                        TipoFactor=tax["factor"],
                    )
                    if tax["factor"] == "Tasa":
                        amount = pricing.six(net * tax["rate"])
                        transfer.set("TasaOCuota", str(tax["rate"]))
                        transfer.set("Importe", str(amount))
                        tax_sum += amount
            gross_sum += gross
            discount_sum += discount
        root.set("SubTotal", str(money(gross_sum)))
        root.set("Descuento", str(money(discount_sum)))
        if tax_sum:
            ET.SubElement(root, f"{{{c}}}Impuestos", TotalImpuestosTrasladados=str(money(tax_sum)))
        complement = ET.SubElement(root, f"{{{c}}}Complemento")
        ET.SubElement(
            complement,
            f"{{{t}}}TimbreFiscalDigital",
            UUID=invoice["uuid"],
            SelloSAT="sat",
            SelloCFD="cfd",
            FechaTimbrado="2026-10-06T00:00:00",
        )
        return ET.tostring(root)

    def cancel_invoice(self, identifier, motive, substitution_uuid):
        self.cancels += 1
        if self.cancel_accepted:
            self.invoices[identifier]["status"] = "canceled"
            self.invoices[identifier]["cancellation_status"] = "accepted"
        else:
            self.invoices[identifier]["cancellation_status"] = "pending"
        return {"cancellation_status": "pending"}

    def download_pdf(self, identifier):
        return b"%PDF-1.7\nfixture"

    def close(self):
        pass


@pytest.fixture
def provider(monkeypatch, db):
    monkeypatch.setattr(
        settings, "kova_cfdi_credentials_key", SecretStr(Fernet.generate_key().decode())
    )
    monkeypatch.setattr(settings, "kova_cfdi_enabled", True)
    fake = FakeProvider(db)

    def factory(key, environment="test", **kwargs):
        fake.environment = environment
        return fake

    monkeypatch.setattr(service, "FacturapiProvider", factory)
    return fake


def prepare_sale(client, environment="test", price="100.00", discount="0.00", tax_rate="0.00"):
    signup = _signup_verify_login(client, f"cfdi-{uuid4().hex}@example.com", "CFDI")
    product = _create_product(client, price=price)
    total = (Decimal(price) - Decimal(discount)) * (Decimal(1) + Decimal(tax_rate) / 100)
    response = client.post(
        "/api/v1/orders",
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "discount_amount": discount,
            "tax_rate": tax_rate,
            "payments": [
                {"method": "bank_transfer", "amount": str(total.quantize(Decimal("0.01")))}
            ],
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    sale = response.json()
    assert client.put("/api/v1/integrations/issuer", json=ISSUER).status_code == 200
    request = client.post(
        "/api/v1/integrations/invoice-requests",
        json={"order_id": sale["id"], "recipient": RECIPIENT},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert request.status_code == 201, request.text
    connection = client.put(
        f"{BASE}/connection",
        json={"environment": environment, "api_key": f"sk_{environment}_fixture_not_a_real_key"},
    )
    assert connection.status_code == 200, connection.text
    payload = {
        "request_id": request.json()["id"],
        "environment": environment,
        "payment_form": "03",
        "lines": [
            {
                "order_item_id": item["id"],
                "product_key": "50181900",
                "unit_key": "H87",
                "tax_kind": "iva16" if tax_rate == "16.00" else "not_subject",
                "tax_included": False,
            }
            for item in sale["items"]
        ],
    }
    return signup, sale, payload


def issue(client, payload, key="cfdi-create"):
    return client.post(f"{BASE}/documents", json=payload, headers={"Idempotency-Key": key})


def test_test_issuance_preserves_private_downloads_and_never_touches_ledger(client, db, provider):
    signup, sale, payload = prepare_sale(client)
    context = client.get(f"{BASE}/requests/{payload['request_id']}/context")
    assert context.status_code == 200, context.text
    assert context.json()["suggested_payment_forms"] == ["03"]
    response = issue(client, payload)
    assert response.status_code == 201, response.text
    document = response.json()
    assert document["state"] == "issued" and document["xml_available"] is True
    assert provider.posts == 1
    assert issue(client, payload).json()["id"] == document["id"]
    assert provider.posts == 1
    assert (
        db.query(FiscalIndividualInvoiceEvent)
        .filter_by(tenant_id=UUID(signup["tenant_id"]))
        .count()
        == 0
    )
    row = db.query(CfdiConnection).filter_by(tenant_id=UUID(signup["tenant_id"])).one()
    assert "sk_test_" not in row.encrypted_api_key
    for suffix in ("xml", "pdf"):
        download = client.get(f"{BASE}/documents/{document['id']}/{suffix}")
        assert download.status_code == 200, download.text
        assert "no-store" in download.headers["cache-control"]
        assert "test-sin-validez-fiscal" in download.headers["content-disposition"]
    assert not service.live_reservation(db, UUID(signup["tenant_id"]), UUID(sale["id"]))


def test_live_issuance_and_cancellation_only_update_ledger_when_confirmed(client, db, provider):
    signup, sale, payload = prepare_sale(client, "live")
    response = issue(client, payload)
    assert response.status_code == 201, response.text
    document = response.json()
    assert document["state"] == "issued"
    tenant = UUID(signup["tenant_id"])
    assert service.live_reservation(db, tenant, UUID(sale["id"]))
    assert db.query(FiscalIndividualInvoiceEvent).filter_by(tenant_id=tenant).count() == 1
    for _ in range(2):
        assert (
            client.post(f"{BASE}/documents/{document['id']}/reconcile").json()["state"] == "issued"
        )
    assert db.query(FiscalIndividualInvoiceEvent).filter_by(tenant_id=tenant).count() == 1
    endpoint = f"{BASE}/documents/{document['id']}/cancel"
    cancel = client.post(endpoint, json={"motive": "02"}, headers={"Idempotency-Key": "cancel"})
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["state"] == "cancel_pending"
    assert (
        db.query(FiscalIndividualInvoiceEvent)
        .filter_by(tenant_id=tenant, status="reopened")
        .count()
        == 0
    )
    assert (
        client.post(
            endpoint, json={"motive": "02"}, headers={"Idempotency-Key": "cancel"}
        ).status_code
        == 200
    )
    assert provider.cancels == 1
    provider.invoices[document["provider_id"]]["status"] = "canceled"
    provider.invoices[document["provider_id"]]["cancellation_status"] = "accepted"
    assert client.post(f"{BASE}/documents/{document['id']}/reconcile").json()["state"] == "canceled"
    assert client.post(f"{BASE}/documents/{document['id']}/reconcile").json()["state"] == "canceled"
    assert not service.live_reservation(db, tenant, UUID(sale["id"]))
    assert (
        db.query(FiscalIndividualInvoiceEvent)
        .filter_by(tenant_id=tenant, status="reopened")
        .count()
        == 1
    )


def test_timeout_retains_reservation_and_no_repost_even_on_different_key(client, db, provider):
    signup, sale, payload = prepare_sale(client, "live")
    provider.raise_create = ProviderError("provider_timeout", definitive=False, transient=True)
    response = issue(client, payload)
    assert response.status_code == 201, response.text
    document = response.json()
    assert document["state"] == "unknown"
    assert issue(client, payload).json()["id"] == document["id"]
    assert issue(client, payload, "another-key").status_code == 409
    assert provider.posts == 1
    assert client.post(f"{BASE}/documents/{document['id']}/reconcile").json()["state"] == "unknown"
    assert provider.posts == 1
    assert service.live_reservation(db, UUID(signup["tenant_id"]), UUID(sale["id"]))


def test_xml_integrity_and_environment_fail_closed(client, db, provider):
    signup, sale, payload = prepare_sale(client, "live")
    provider.xml_total = Decimal("999.00")
    response = issue(client, payload)
    assert response.status_code == 201, response.text
    document = response.json()
    assert document["state"] == "integrity_error"
    assert document["xml_available"] is False
    assert service.live_reservation(db, UUID(signup["tenant_id"]), UUID(sale["id"]))
    assert (
        db.query(FiscalIndividualInvoiceEvent)
        .filter_by(tenant_id=UUID(signup["tenant_id"]))
        .count()
        == 0
    )
    provider.xml_total = None
    provider.foreign_environment = True
    result = client.post(f"{BASE}/documents/{document['id']}/reconcile")
    assert result.json()["state"] == "integrity_error"
    assert result.json()["last_error_code"] == "provider_environment_mismatch"


def test_pricing_explicit_included_added_discount_and_payment(client, provider):
    _, _, payload = prepare_sale(client, price="116.00", discount="11.60")
    payload["lines"][0]["tax_kind"] = "iva16"
    payload["lines"][0]["tax_included"] = True
    preview = client.post(f"{BASE}/preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["subtotal_amount"] == "100.00"
    assert preview.json()["discount_amount"] == "10.00"
    assert preview.json()["tax_amount"] == "14.40"
    assert preview.json()["total_amount"] == "104.40"
    payload["payment_form"] = "01"
    assert client.post(f"{BASE}/preview", json=payload).status_code == 400
    payload["payment_form"] = "03"
    payload["lines"][0]["tax_included"] = False
    assert client.post(f"{BASE}/preview", json=payload).status_code == 400


def test_private_validation_auth_and_cross_tenant(client, db, provider):
    signup, sale, payload = prepare_sale(client)
    secret = "SECRET-INVALID-KEY"
    result = client.put(f"{BASE}/connection", json={"environment": secret, "api_key": secret})
    assert result.status_code == 422 and secret not in result.text
    doc = issue(client, payload).json()
    _signup_verify_login(client, f"foreign-{uuid4().hex}@example.com", "Foreign")
    assert client.get(f"{BASE}/requests/{payload['request_id']}/context").status_code == 404
    assert client.post(f"{BASE}/documents/{doc['id']}/reconcile").status_code == 404
    assert client.get(f"{BASE}/documents/{doc['id']}/xml").status_code == 404
    assert client.get(f"{BASE}/documents").json() == []


def test_provider_idempotency_400_is_unknown_and_never_reposted(client, db, provider):
    signup, sale, payload = prepare_sale(client, "live")
    real = FacturapiProvider(
        "sk_live_fixture",
        environment="live",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                400, json={"code": "idempotency_key_in_use", "message": "busy"}
            )
        ),
    )
    with pytest.raises(ProviderError) as error:
        real.create_invoice({"external_id": "fixture"}, "fixture-key")
    real.close()
    assert error.value.definitive is False
    provider.raise_create = error.value
    doc = issue(client, payload).json()
    assert doc["state"] == "unknown"
    assert doc["last_error_code"] == "provider_idempotency_in_use"
    assert issue(client, payload, "other").status_code == 409
    assert provider.posts == 1
    assert service.live_reservation(db, UUID(signup["tenant_id"]), UUID(sale["id"]))


def test_pending_never_reposts_and_reconcile_confirms_exactly_once(client, db, provider):
    signup, _, payload = prepare_sale(client, "live")
    provider.initial_state = "pending"
    document = issue(client, payload).json()
    assert document["state"] == "pending" and not document["xml_available"]
    assert issue(client, payload, "different").status_code == 409
    provider.invoices[document["provider_id"]]["status"] = "valid"
    assert client.post(f"{BASE}/documents/{document['id']}/reconcile").json()["state"] == "issued"
    assert client.post(f"{BASE}/documents/{document['id']}/reconcile").json()["state"] == "issued"
    assert provider.posts == 1
    assert (
        db.query(FiscalIndividualInvoiceEvent)
        .filter_by(tenant_id=UUID(signup["tenant_id"]))
        .count()
        == 1
    )


def test_rejected_receiver_can_be_corrected_without_rewriting_request(client, db, provider):
    _, _, payload = prepare_sale(client)
    provider.raise_create = ProviderError("provider_invalid_request", definitive=True)
    assert issue(client, payload).json()["state"] == "rejected"
    payload["recipient"] = {**RECIPIENT, "rfc": "AAA010101AAA", "legal_name": "Receptor corregido"}
    preview = client.post(f"{BASE}/preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["recipient_snapshot"]["rfc"] == "AAA010101AAA"
    assert issue(client, payload).status_code == 409
    provider.raise_create = None
    issued = issue(client, payload, "corrected")
    assert issued.status_code == 201, issued.text
    assert issued.json()["state"] == "issued"
    assert issued.json()["recipient_snapshot"]["rfc"] == "AAA010101AAA"
    context = client.get(f"{BASE}/requests/{payload['request_id']}/context").json()
    assert context["recipient"]["rfc"] == RECIPIENT["rfc"]


def test_preview_rejects_refund_and_void_and_wrong_classification(client, db, provider):
    _, sale, payload = prepare_sale(client, tax_rate="16.00", discount="10.00")
    assert client.post(f"{BASE}/preview", json=payload).json()["total_amount"] == "104.40"
    duplicated = {**payload, "lines": payload["lines"] * 2}
    assert client.post(f"{BASE}/preview", json=duplicated).status_code == 400
    missing = {**payload, "lines": [{**payload["lines"][0], "order_item_id": str(uuid4())}]}
    assert client.post(f"{BASE}/preview", json=missing).status_code == 400
    refund = client.post(
        f"/api/v1/orders/{sale['id']}/refunds",
        json={
            "reason": "customer_return",
            "refund_payment_method": "bank_transfer",
            "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
        },
        headers={"Idempotency-Key": "refund"},
    )
    assert refund.status_code == 201, refund.text
    assert client.post(f"{BASE}/preview", json=payload).status_code == 400


def test_xml_external_entities_are_rejected_before_ledger(client, db, provider):
    signup, _, payload = prepare_sale(client, "live")
    provider.download_xml = lambda identifier: (
        b'<!DOCTYPE x [<!ENTITY file SYSTEM "file:///etc/passwd">]><x>&file;</x>'
    )
    document = issue(client, payload).json()
    assert document["state"] == "integrity_error"
    assert not document["xml_available"]
    assert (
        db.query(FiscalIndividualInvoiceEvent)
        .filter_by(tenant_id=UUID(signup["tenant_id"]))
        .count()
        == 0
    )


def test_connection_environment_and_expired_live_certificates_block_post(client, provider):
    _, _, payload = prepare_sale(client, "live")
    result = client.put(
        f"{BASE}/connection", json={"environment": "test", "api_key": "sk_live_fixture_key"}
    )
    assert result.status_code == 400
    original = provider.organization
    provider.organization = lambda: {
        **original(),
        "certificate": {"has_certificate": True, "expires_at": "2020-01-01T00:00:00Z"},
    }
    result = issue(client, payload)
    assert result.status_code == 400, result.text
    assert provider.posts == 0


def test_permissions_and_branch_scope(client, db, provider):
    from app.auth.models import Membership
    from app.branches.models import Branch
    from app.orders.models import Order

    signup, sale, payload = prepare_sale(client)
    tenant = UUID(signup["tenant_id"])
    branch = Branch(tenant_id=tenant, name="Otra sucursal")
    db.add(branch)
    db.commit()
    foreign = client.get(
        f"{BASE}/requests/{payload['request_id']}/context",
        headers={"X-Kova-Branch": str(branch.id)},
    )
    assert foreign.status_code == 404, foreign.text
    membership = db.query(Membership).filter_by(tenant_id=tenant).one()
    membership.role = "cashier"
    db.commit()
    assert client.get(f"{BASE}/status").status_code == 403
    assert client.post(f"{BASE}/preview", json=payload).status_code == 403
    row = db.get(Order, UUID(sale["id"]))
    row.status = "voided"
    membership.role = "owner"
    db.commit()
    assert client.post(f"{BASE}/preview", json=payload).status_code == 400


def test_database_partial_unique_blocks_concurrent_active_documents(client, db, provider):
    from sqlalchemy.exc import IntegrityError

    signup, _, payload = prepare_sale(client)
    document = issue(client, payload).json()
    row = db.query(CfdiDocument).filter_by(id=UUID(document["id"])).one()
    duplicate = CfdiDocument(
        tenant_id=row.tenant_id,
        branch_id=row.branch_id,
        order_id=row.order_id,
        request_id=row.request_id,
        connection_id=row.connection_id,
        environment=row.environment,
        organization_id=row.organization_id,
        state="submitting",
        idempotency_key="racing-key",
        request_hash=row.request_hash,
        external_id=f"racing-{uuid4()}",
        provider_key=f"racing-{uuid4()}",
        payload=row.payload,
        total_amount=row.total_amount,
        created_by_user_id=row.created_by_user_id,
    )
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(duplicate)
        db.flush()
    assert provider.posts == 1
    assert db.query(CfdiDocument).filter_by(tenant_id=UUID(signup["tenant_id"])).count() == 1


def test_pricing_rejects_sat_rounding_mismatch_before_post(client, provider):
    _, _, payload = prepare_sale(client, price="1.00", discount="0.10")
    payload["lines"][0].update({"tax_kind": "iva16", "tax_included": True})
    response = client.post(f"{BASE}/preview", json=payload)
    assert response.status_code == 400, response.text
    assert "concilia" in response.json()["detail"]
    assert issue(client, payload).status_code == 400
    assert provider.posts == 0


def test_test_provider_can_use_fictitious_issuer_without_csd(client, db, provider):
    signup, _, payload = prepare_sale(client)
    original = provider.download_xml

    def demo(identifier):
        from xml.etree import ElementTree as ET

        root = ET.fromstring(original(identifier))
        issuer = root.find("{http://www.sat.gob.mx/cfd/4}Emisor")
        issuer.set("Rfc", "AAA010101AAA")
        issuer.set("Nombre", "EMISOR DE PRUEBA")
        issuer.set("RegimenFiscal", "626")
        root.set("LugarExpedicion", "64000")
        return ET.tostring(root)

    provider.download_xml = demo
    result = issue(client, payload)
    assert result.status_code == 201, result.text
    assert result.json()["state"] == "issued"
    assert (
        db.query(FiscalIndividualInvoiceEvent)
        .filter_by(tenant_id=UUID(signup["tenant_id"]))
        .count()
        == 0
    )
