"""Provision only Café Cortés; exercise the deployed APIs with temporary QA users.

Uses the existing demo seed provisioning pattern. Credentials never enter output.
Historical timestamp adjustments touch only rows returned by this run's APIs.
No subscription, deployment, existing password, migration, or RLS changes.
"""

import argparse
import json
import secrets
import sys
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

sys.path.append(str(Path(__file__).resolve().parents[1]))

import httpx
from cafe_cortes_plan import build_plan
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.auth.service import hash_password
from app.branches.models import Branch
from app.config import settings, sqlalchemy_database_url
from app.tenants.models import Tenant

SLUG = "cafe-cortes-demo-20261008"
EMAIL = "fkr2d2@hotmail.com"
PREVIOUS_TENANT = UUID("02f4c80d-26f9-4bce-b9da-275f45151d8e")
OWNER_ID = UUID("45f650e5-dfa2-408a-b129-7062f1eec013")
RELEASE = "a18ba1e6b59752c73ed73b43bb3a1bb6b4ba2ef5"
BASE = "https://kovasuite.com"


class LiveAPI:
    def __init__(self, email, password):
        self.client = httpx.Client(base_url=BASE, timeout=45, headers={"Origin": BASE})
        result = self.call("POST", "/auth/login", {"email": email, "password": password})
        assert result["message"] == "Logged in."

    def call(self, method, path, body=None, key=None, branch=None, expected=None):
        headers = {}
        if key:
            headers["Idempotency-Key"] = key
        if branch:
            headers["X-Kova-Branch"] = str(branch)
        csrf = self.client.cookies.get("csrf_token")
        if csrf:
            headers["X-CSRF-Token"] = csrf
        response = self.client.request(method, "/api/v1" + path, json=body, headers=headers)
        if expected is not None:
            assert response.status_code == expected, f"Unexpected status: {method} {path}"
        elif response.status_code >= 400:
            # No request/headers/cookies/passwords are printed on failure.
            raise RuntimeError(
                f"API {method} {path}: HTTP {response.status_code}: {response.text[:400]}"
            )
        return response.json() if response.content else None


class Seed:
    def __init__(self, plan, output):
        self.plan, self.output = plan, output
        self.engine = create_engine(sqlalchemy_database_url(settings.database_url), echo=False)
        self.report = {
            "release": RELEASE,
            "anchor": plan["anchor"],
            "url": BASE,
            "checks": [],
            "events": [],
            "deletion_kofi": "User will complete later",
        }
        self.products, self.branches, self.lots, self.shifts = {}, {}, {}, {}
        self.temp_users = []

    def temporary_cashier(self):
        now = datetime.now(UTC)
        password = secrets.token_urlsafe(32) + "9a"
        email = f"qa-cafe-cajero-{uuid4().hex[:12]}@kovademo.com"
        with Session(self.engine) as db:
            user = User(
                email=email,
                hashed_password=hash_password(password),
                is_email_verified=True,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add(user)
            db.flush()
            self.temp_users.append(user.id)
            db.add(
                Membership(
                    tenant_id=self.tid,
                    user_id=user.id,
                    role="cashier",
                    allowed_branch_id=UUID(self.branches["centro"]),
                    is_active=True,
                    created_at=now,
                )
            )
            db.commit()
        return LiveAPI(email, password)

    def check(self, label, actual=True):
        assert actual, label
        self.report["checks"].append(label)

    def bootstrap(self):
        health = httpx.get(BASE + "/api/health", timeout=30).json()
        self.check("Deployed backend is PR 181", health.get("release_sha") == RELEASE)
        with Session(self.engine) as db:
            version = db.execute(text("select version_num from alembic_version")).scalar_one()
            self.check("Migration 0077_inventory_lots", version == "0077_inventory_lots")
            owner_id = (
                db.query(User.id).filter_by(id=OWNER_ID, email=EMAIL, is_active=True).scalar()
            )
            assert owner_id == OWNER_ID, "Expected demo owner identity missing"
            tenant = db.query(Tenant).filter_by(slug=SLUG).first()
            if tenant is None:
                # Explicit seed provisioning, matching seed_demo.py; tenant.created_at
                # remains today so the native signup trial is never bypassed.
                tenant = Tenant(name="Café Cortés — Demo", slug=SLUG)
                db.add(tenant)
                db.flush()
                # Migration 0068 creates the principal branch through a trigger.
                # Rename that branch through the native API after committing.
            self.tid = tenant.id
            assert db.query(Branch.id).filter_by(id=self.tid, tenant_id=self.tid).scalar() == self.tid
            self.report["tenant_id"] = str(self.tid)
            for membership in db.query(Membership).filter_by(user_id=owner_id, is_active=True):
                if membership.tenant_id != self.tid:
                    assert membership.tenant_id == PREVIOUS_TENANT and membership.role == "cashier"
                    membership.is_active = False
            if not db.query(Membership).filter_by(tenant_id=self.tid, user_id=owner_id).first():
                db.add(
                    Membership(
                        tenant_id=self.tid,
                        user_id=owner_id,
                        role="owner",
                        is_active=True,
                        created_at=datetime.now(UTC),
                    )
                )
            # Old sessions cannot select the previous tenant after the move.
            db.query(UserSession).filter_by(user_id=owner_id, tenant_id=PREVIOUS_TENANT).filter(
                UserSession.revoked_at.is_(None)
            ).update({"revoked_at": datetime.now(UTC)})
            now = datetime.now(UTC)
            qa_email = f"qa-cafe-cortes-{uuid4().hex[:12]}@kovademo.com"
            self.qa_password = secrets.token_urlsafe(32) + "9a"
            qa = User(
                email=qa_email,
                hashed_password=hash_password(self.qa_password),
                is_email_verified=True,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add(qa)
            db.flush()
            db.add(
                Membership(
                    tenant_id=self.tid, user_id=qa.id, role="owner", is_active=True, created_at=now
                )
            )
            self.temp_users.append(qa.id)
            db.commit()
        self.api = LiveAPI(qa_email, self.qa_password)
        me = self.api.call("GET", "/auth/me")
        self.check("Cookie login resolves only demo tenant", me["tenant_id"] == str(self.tid))
        billing = self.api.call("GET", "/billing/subscription")
        self.report["billing"] = billing
        self.api.call(
            "PUT",
            "/settings/business-profile",
            {
                "public_name": "Café Cortés — Demo",
                "support_email": EMAIL,
                "timezone": self.plan["timezone"],
                "locale": "es-MX",
                "currency": "MXN",
            },
        )
        self.api.call(
            "PUT",
            "/settings/receipt",
            {
                "receipt_business_name": "Café Cortés — Demo",
                "footer": "DEMOSTRACIÓN · Bolsas terminadas · Datos y duraciones ficticios",
                "default_tax_rate": "0.00",
            },
        )
        self.branches["central"] = str(self.tid)
        self.api.call(
            "PATCH",
            f"/branches/{self.tid}",
            {"name": "Almacén central", "address": "Ubicación ficticia · Demo"},
            key="cc-v1-branch-central",
        )
        for branch in ("centro", "norte"):
            row = self.api.call(
                "POST",
                "/branches",
                {"name": self.plan["branches"][branch], "address": "Ubicación ficticia · Demo"},
                key="cc-v1-branch-" + branch,
            )
            self.branches[branch] = row["id"]
        for sku, data in self.plan["catalog"].items():
            product = self.api.call(
                "POST",
                "/catalog/products",
                {
                    "name": f"Tacámbaro · Bolsa de café {sku} g",
                    "sku": "TC-" + sku,
                    "description": "Café terminado en bolsa entera. Origen y "
                    "atributos: supuestos de demo.",
                    "price_amount": str(data["price"]),
                    "cost_price": str(data["cost"]),
                    "track_inventory": True,
                    "track_lots": True,
                    "rotation_label": "fecha_objetivo",
                    "rotation_days": 45,
                    "expiry_days": None,
                    "low_stock_threshold": data["threshold"],
                },
                key="cc-v1-product-" + sku,
            )
            self.products[sku] = product["id"]
        for lot, data in self.plan["lots"].items():
            pid = self.products[data["sku"]]
            existing_lots = self.api.call("GET", f"/inventory/products/{pid}/lots")
            existing = next(
                (
                    row
                    for row in existing_lots
                    if row["code"] == f"TC-{lot}-{data['manufactured_on'].replace('-', '')}"
                ),
                None,
            )
            self.api.call(
                "PATCH",
                "/catalog/products/" + pid,
                {"rotation_days": data["rotation_days"]},
                key="cc-v1-rule-" + lot,
            )
            suggested = self.api.call(
                "GET",
                f"/inventory/products/{pid}/lots/suggestions"
                f"?manufactured_on={data['manufactured_on']}",
            )
            if existing is None:
                self.check(
                    "Suggestion confirmed " + lot, suggested["rotation_on"] == data["rotation_on"]
                )
            row = self.api.call(
                "POST",
                f"/inventory/products/{pid}/lots",
                {
                    "code": f"TC-{lot}-{data['manufactured_on'].replace('-', '')}",
                    "manufactured_on": data["manufactured_on"],
                    "rotation_on": data["rotation_on"],
                    "expires_on": None,
                },
                key="cc-v1-lot-" + lot,
            )
            self.lots[lot] = row["id"]
        for lot, data in self.plan["lots"].items():
            rows = self.api.call("GET", f"/inventory/products/{self.products[data['sku']]}/lots")
            row = next(row for row in rows if row["id"] == self.lots[lot])
            self.check(
                "Rule changes preserve saved dates " + lot,
                row["rotation_on"] == data["rotation_on"],
            )
        self.report.update(branches=self.branches, products=self.products, lots=self.lots)

    def stamp(self, queries, when):
        # Caller passes fixed table/column templates; IDs and timestamps are bound.
        with Session(self.engine) as db:
            for query, params in queries:
                db.execute(
                    text(query), {"tid": self.tid, "at": datetime.fromisoformat(when), **params}
                )
            db.commit()

    def stamp_order(self, oid, when):
        self.stamp(
            [
                (
                    "update orders set "
                    "occurred_at=:at,created_at=:at,updated_at=:at where tenant_id=:tid and id=:id",
                    {"id": oid},
                ),
                (
                    "update payments set created_at=:at where tenant_id=:tid and order_id=:id",
                    {"id": oid},
                ),
                (
                    "update inventory_movements set created_at=:at where "
                    "tenant_id=:tid and order_id=:id",
                    {"id": oid},
                ),
            ],
            when,
        )

    def parts(self, parts):
        return [{"lot_id": self.lots[lot], "quantity": qty} for lot, qty in parts.items()]

    def sale(self, event, suffix="", parts=None):
        items = event.get("items") or [{"sku": "250", "parts": parts}]
        total = sum(
            self.plan["catalog"][item["sku"]]["price"] * sum(item["parts"].values())
            for item in items
        ) - event.get("discount", 0)
        method = event.get("method", "cash")
        payment = {"method": method, "amount": str(total)}
        if method == "cash":
            payment["amount_tendered"] = str(total)
        row = self.api.call(
            "POST",
            "/orders",
            {
                "items": [
                    {
                        "product_id": self.products[item["sku"]],
                        "quantity": sum(item["parts"].values()),
                        "lot_allocations": self.parts(item["parts"]),
                    }
                    for item in items
                ],
                "discount_amount": str(event.get("discount", 0)),
                "payments": [payment],
            },
            key=event["key"] + suffix,
            branch=self.branches[event["branch"]],
        )
        self.check(
            "Correct sale amount " + event["key"] + suffix, Decimal(row["total_amount"]) == total
        )
        self.stamp_order(row["id"], event["at"])
        return row

    def execute(self):
        for event in self.plan["events"]:
            kind, key, when = event["kind"], event["key"], event["at"]
            self.report["stage"] = {"key": key, "kind": kind}
            branch = self.branches[event["branch"]]
            row = None
            if kind in ("receive", "waste"):
                sku = self.plan["lots"][event["lot"]]["sku"]
                body = {
                    "quantity_delta": event["quantity"] * (-1 if kind == "waste" else 1),
                    "reason": "DEMO · "
                    + (
                        "Bolsa dañada: merma identificada"
                        if kind == "waste"
                        else "Entrada de bolsas terminadas"
                    ),
                    "lot_allocations": self.parts({event["lot"]: event["quantity"]}),
                }
                if kind == "waste":
                    body["reason_code"] = "merma"
                row = self.api.call(
                    "POST",
                    f"/inventory/products/{self.products[sku]}/adjustments",
                    body,
                    key=key,
                    branch=branch,
                )
                self.stamp(
                    [
                        (
                            "update inventory_movements set created_at=:at where "
                            "tenant_id=:tid and id=:id",
                            {"id": row["id"]},
                        )
                    ],
                    when,
                )
            elif kind == "transfer":
                sku = self.plan["lots"][event["lot"]]["sku"]
                reason = "DEMO · Abastecimiento pequeño · " + key
                row = self.api.call(
                    "POST",
                    "/branches/transfers",
                    {
                        "source_branch_id": self.branches[event["source"]],
                        "destination_branch_id": branch,
                        "product_id": self.products[sku],
                        "quantity": event["quantity"],
                        "reason": reason,
                        "lot_allocations": self.parts({event["lot"]: event["quantity"]}),
                    },
                    key=key,
                )
                self.stamp(
                    [
                        (
                            "update inventory_transfers set created_at=:at where "
                            "tenant_id=:tid and id=:id",
                            {"id": row["id"]},
                        ),
                        (
                            "update inventory_movements set created_at=:at where "
                            "tenant_id=:tid and reason=:reason and product_id=:pid",
                            {
                                "reason": f"Traspaso {row['id']}: {reason}",
                                "pid": self.products[sku],
                            },
                        ),
                    ],
                    when,
                )
            elif kind == "open":
                row = self.api.call(
                    "POST", "/shifts", {"opening_cash_amount": "500.00"}, key=key, branch=branch
                )
                self.shifts[event["branch"]] = row["id"]
                self.stamp(
                    [
                        (
                            "update shifts set opened_at=:at where tenant_id=:tid and id=:id",
                            {"id": row["id"]},
                        ),
                        (
                            "update cash_movements set created_at=:at where "
                            "tenant_id=:tid and shift_id=:id and type='opening_balance'",
                            {"id": row["id"]},
                        ),
                    ],
                    when,
                )
            elif kind == "sale":
                row = self.sale(event)
                if (
                    len(
                        next((item["parts"] for item in event["items"] if item["sku"] == "250"), {})
                    )
                    > 1
                ):
                    self.check(
                        "Sale consumes multiple native lots",
                        len(
                            next(
                                item["lot_allocations"]
                                for item in row["items"]
                                if item["product_id"] == self.products["250"]
                            )
                        )
                        > 1,
                    )
                    before = self.api.call("GET", "/inventory/stock", branch=branch)
                    replay = self.sale(event)
                    after = self.api.call("GET", "/inventory/stock", branch=branch)
                    self.check(
                        "Same sale identity and no duplicate stock discount",
                        replay["id"] == row["id"] and before == after,
                    )
            elif kind == "exception":
                row = self.sale(event, "-sale", {event["lot"]: 1})
                path = "/orders/" + row["id"]
                if event["action"] == "refund":
                    result = self.api.call(
                        "POST",
                        path + "/refunds",
                        {
                            "items": [{"order_item_id": row["items"][0]["id"], "quantity": 1}],
                            "reason": "customer_return",
                            "refund_payment_method": "cash",
                        },
                        key=key,
                        branch=branch,
                    )
                    self.stamp(
                        [
                            (
                                "update refunds set created_at=:at where tenant_id=:tid and "
                                "order_id=:id",
                                {"id": row["id"]},
                            )
                        ],
                        when,
                    )
                else:
                    self.api.call(
                        "POST",
                        path + "/void",
                        {"reason": "operator_error"},
                        key=key + "-missing",
                        branch=branch,
                        expected=400,
                    )
                    result = self.api.call(
                        "POST",
                        path + "/void",
                        {
                            "reason": "operator_error",
                            "not_delivered": event["action"] == "void_no_delivery",
                        },
                        key=key,
                        branch=branch,
                    )
                    self.stamp(
                        [
                            (
                                "update voids set created_at=:at where tenant_id=:tid and "
                                "order_id=:id",
                                {"id": row["id"]},
                            )
                        ],
                        when,
                    )
                    self.stamp_order(row["id"], when)
                self.report.setdefault("exceptions", []).append(
                    {"action": event["action"], "order_id": row["id"], "result": result}
                )
            elif kind == "close":
                sid = self.shifts[event["branch"]]
                current = self.api.call("GET", "/shifts/" + sid, branch=branch)
                row = self.api.call(
                    "POST",
                    f"/shifts/{sid}/close",
                    {"actual_cash_amount": current["expected_cash_amount"]},
                    key=key,
                    branch=branch,
                )
                self.check("Balanced closing " + key, row["reconciliation_status"] == "balanced")
                self.stamp(
                    [
                        (
                            "update shifts set closed_at=:at where tenant_id=:tid and id=:id",
                            {"id": sid},
                        ),
                        (
                            "update cash_movements set created_at=:at where "
                            "tenant_id=:tid and shift_id=:id and type<>'opening_balance'",
                            {"id": sid},
                        ),
                    ],
                    when,
                )
            elif kind == "reserve":
                row = self.api.call(
                    "POST",
                    "/customer-orders",
                    {
                        "items": [{"product_id": self.products["250"], "quantity": 3}],
                        "customer_name": "Cliente ficticio · Pedido para mañana",
                        "promised_at": (
                            datetime.fromisoformat(when) + timedelta(days=1)
                        ).isoformat(),
                        "note": "DEMO · Tres bolsas reservadas; no representan un cliente real",
                    },
                    key=key,
                    branch=branch,
                )
                row = self.api.call(
                    "POST",
                    f"/customer-orders/{row['id']}/confirm",
                    {"version": row["version"]},
                    key=key + "-confirm",
                    branch=branch,
                )
                self.report["reservation"] = row
                self.check(
                    "Confirmed order reserves planned attention lot",
                    row["lot_reservations"][self.products["250"]] == self.parts({"250-B": 3}),
                )
            self.report["events"].append({**event, "id": row.get("id") if row else None})
            self.save()
            if len(self.report["events"]) % 30 == 0:
                print(
                    f"Verified {len(self.report['events'])}/{len(self.plan['events'])} operations"
                )

    def verify(self):
        self.report["balances"] = []
        for branch, bid in self.branches.items():
            rows = self.api.call("GET", "/inventory/stock", branch=bid)
            for sku, pid in self.products.items():
                lots = self.api.call("GET", f"/inventory/products/{pid}/lots", branch=bid)
                item = next(row for row in rows if row["product_id"] == pid)
                self.check(
                    f"Stock=sum(lots) {branch}/{sku}",
                    item["stock_on_hand"] == sum(row["stock_on_hand"] for row in lots),
                )
                self.check(
                    f"Reservations=sum(lots) {branch}/{sku}",
                    item["reserved_quantity"] == sum(row["reserved_quantity"] for row in lots),
                )
                for lot, lid in self.lots.items():
                    if self.plan["lots"][lot]["sku"] != sku:
                        continue
                    actual = next(row for row in lots if row["id"] == lid)
                    expected = next(
                        row
                        for row in self.plan["expected"]
                        if row["branch"] == branch and row["lot"] == lot
                    )
                    self.check(
                        f"Expected balance {branch}/{lot}",
                        (
                            actual["stock_on_hand"],
                            actual["reserved_quantity"],
                            actual["available_quantity"],
                        )
                        == (expected["physical"], expected["reserved"], expected["available"]),
                    )
                    self.check(
                        f"Transfer identity and dates {branch}/{lot}",
                        actual["manufactured_on"] == self.plan["lots"][lot]["manufactured_on"]
                        and actual["rotation_on"] == self.plan["lots"][lot]["rotation_on"],
                    )
                    self.report["balances"].append({"branch": branch, "lot": lot, **actual})
        # Try to consume physical stock including reserved units. Neither path
        # may take the three reserved bags: both must be rejected atomically.
        bid, pid, lid = self.branches["centro"], self.products["250"], self.lots["250-B"]
        self.api.call(
            "POST",
            "/orders",
            {
                "items": [
                    {
                        "product_id": pid,
                        "quantity": 5,
                        "lot_allocations": [{"lot_id": lid, "quantity": 5}],
                    }
                ],
                "payments": [{"method": "bank_transfer", "amount": "975.00"}],
            },
            key="cc-v1-denied-sale",
            branch=bid,
            expected=409,
        )
        self.api.call(
            "POST",
            "/branches/transfers",
            {
                "source_branch_id": bid,
                "destination_branch_id": self.branches["norte"],
                "product_id": pid,
                "quantity": 5,
                "reason": "DEMO · Reserva no transferible",
                "lot_allocations": [{"lot_id": lid, "quantity": 5}],
            },
            key="cc-v1-denied-transfer",
            expected=409,
        )
        self.check("Reservation blocks another sale and transfer")
        start = (date.fromisoformat(self.plan["anchor"]) - timedelta(days=34)).isoformat()
        self.report["comparison"] = self.api.call(
            "GET", f"/reports/branches?start_date={start}&end_date={self.plan['anchor']}"
        )
        for branch, bid in self.branches.items():
            expected_net = sum(
                sum(
                    self.plan["catalog"][item["sku"]]["price"] * sum(item["parts"].values())
                    for item in event["items"]
                )
                - event["discount"]
                for event in self.plan["events"]
                if event["kind"] == "sale" and event["branch"] == branch
            )
            actual = next(
                row for row in self.report["comparison"]["branches"] if row["branch_id"] == bid
            )
            self.check(
                "Branch net sales reconcile " + branch, Decimal(actual["net_sales"]) == expected_net
            )
        self.report["velocity"] = {
            branch: self.api.call("GET", "/inventory/velocity", branch=bid)
            for branch, bid in self.branches.items()
        }
        with Session(self.engine) as db:
            # Prefix sums prove no historical negative stock per lot/location,
            # stronger than checking only the eventual net balance.
            bad = db.execute(
                text("""select count(*) from (
                select sum(a.quantity_delta) over (partition by a.branch_id,a.lot_id
                order by m.created_at,case when a.quantity_delta>0 then 0 else 1 end,m.id
                rows unbounded preceding) as balance,
                m.created_at::date < l.manufactured_on as before_roast
                from inventory_lot_allocations a join inventory_movements m on m.id=a.movement_id
                join inventory_lots l on l.id=a.lot_id where a.tenant_id=:tid
            ) s where balance<0 or before_roast"""),
                {"tid": self.tid},
            ).scalar_one()
            self.check(
                "All historical prefix balances nonnegative; no sale before roasting/receipt",
                bad == 0,
            )
            role = db.execute(
                text("select rolsuper or rolbypassrls from pg_roles where rolname='kova_app'")
            ).scalar_one()
            self.check("Runtime role cannot bypass RLS", role is False)
            db.execute(text("SET LOCAL ROLE kova_app"))
            db.execute(
                text("select set_config('app.tenant_id', :tid, true)"), {"tid": str(self.tid)}
            )
            own = db.execute(text("select count(*) from inventory_lots")).scalar_one()
            db.execute(
                text("select set_config('app.tenant_id', :tid, true)"),
                {"tid": str(PREVIOUS_TENANT)},
            )
            leaked = db.execute(
                text("select count(*) from inventory_lots where tenant_id=:tid"), {"tid": self.tid}
            ).scalar_one()
            self.check("Actual kova_app RLS separates KOFI and demo", own >= 5 and leaked == 0)
            db.rollback()
        self.api.call("GET", "/inventory/stock", branch=PREVIOUS_TENANT, expected=404)
        self.check("Deployed API rejects other tenant branch")
        cashier = self.temporary_cashier()
        try:
            cashier.call("GET", "/inventory/stock", branch=self.branches["centro"])
            cashier.call("GET", "/inventory/stock", branch=self.branches["norte"], expected=403)
            cashier.call(
                "POST",
                "/branches/transfers",
                {
                    "source_branch_id": bid,
                    "destination_branch_id": self.branches["norte"],
                    "product_id": pid,
                    "quantity": 1,
                    "reason": "DEMO · Permiso denegado",
                    "lot_allocations": [{"lot_id": lid, "quantity": 1}],
                },
                key="cc-v1-cashier-denied",
                expected=403,
            )
            self.check("Restricted cashier cannot read Norte or transfer")
        finally:
            cashier.client.close()
        self.save()

    def cleanup(self):
        if not self.temp_users:
            return
        with Session(self.engine) as db:
            for uid in self.temp_users:
                db.query(User).filter_by(id=uid).update({"is_active": False})
                db.query(Membership).filter_by(user_id=uid, tenant_id=self.tid).update(
                    {"is_active": False}
                )
                db.query(UserSession).filter_by(user_id=uid).filter(
                    UserSession.revoked_at.is_(None)
                ).update({"revoked_at": datetime.now(UTC)})
            db.commit()
        if hasattr(self, "api"):
            self.api.client.close()

    def save(self):
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.output.write_text(
            json.dumps(self.report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    plan = json.loads(args.manifest.read_text(encoding="utf-8"))
    assert plan == build_plan(date.fromisoformat(plan["anchor"])), (
        "Manifest differs from validated planner"
    )
    if not args.apply:
        print(f"Plan validated: {len(plan['events'])} operations. No writes.")
        return
    seed = Seed(plan, args.output)
    try:
        seed.report["stage"] = "bootstrap"
        seed.bootstrap()
        seed.execute()
        seed.report["stage"] = "verify"
        seed.verify()
        seed.report["stage"] = "complete"
        seed.save()
        print(f"Demo ready: {seed.tid}; {len(seed.report['checks'])} checks passed")
    except Exception as exc:
        seed.report["failure_type"] = type(exc).__name__
        if isinstance(exc, (AssertionError, RuntimeError)):
            seed.report["failure"] = str(exc)[:500]
        diag = getattr(getattr(exc, "orig", None), "diag", None)
        if diag:
            seed.report["database_diagnostic"] = {
                "sqlstate": diag.sqlstate,
                "constraint": diag.constraint_name,
                "table": diag.table_name,
            }
        seed.save()
        raise
    finally:
        seed.cleanup()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # SQLAlchemy exception text can embed a DSN/parameters; never log it.
        print(f"Seed stopped safely ({type(exc).__name__}). Inspect sanitized evidence and stage.")
        sys.exit(1)
