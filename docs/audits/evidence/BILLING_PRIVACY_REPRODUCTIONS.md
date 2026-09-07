# Reproducciones offline billing y privacidad

Ejecutado con Python 3.12, biblioteca estándar. Extrae funciones AST sin importar app/config, abrir DB ni acceder a red. Colaboradores simulados: evidencia de ramas, no integración PostgreSQL.

Resultado: código de salida 0.

```text
CONFIRMED: canceled lifecycle(t=200) + invoice.paid(t=100) becomes active
CONFIRMED: automatic account export includes tenant-linked internal ops_notes body
```

Para repetir: guardar el bloque como script temporal FUERA del repositorio y ajustar ROOT a la raíz del checkout (la versión ejecutada residía en docs/audits/evidence).

```python
"""Offline audit reproductions; stdlib only, no app imports/settings/network/DB.

Execute source functions selected by AST with controlled collaborators. These
are branch-level reproductions, not PostgreSQL or endpoint integration tests.
"""
from __future__ import annotations

import ast
import csv
import io
import json
import logging
import re
import tempfile
import zipfile
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace as NS
from uuid import UUID

ROOT = Path(__file__).resolve().parents[3]


def source_functions(path, names, namespace):
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    selected = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert {n.name for n in selected} == set(names)
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *selected], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(path), "exec"), namespace)


def reproduce_stripe_cross_family():
    subscription = NS(status="canceled", stripe_subscription_id="sub_synthetic",
                      stripe_lifecycle_watermark_at=datetime.fromtimestamp(200, UTC),
                      stripe_lifecycle_event_id="evt_deleted_synthetic",
                      stripe_lifecycle_event_type="customer.subscription.deleted",
                      stripe_payment_watermark_at=None, stripe_payment_event_id=None,
                      stripe_payment_event_type=None, id="synthetic")
    ns = dict(datetime=datetime, UTC=UTC, logger=logging.getLogger("audit"),
              EVENT_FAMILY_LIFECYCLE="lifecycle", EVENT_FAMILY_PAYMENT="payment",
              repository=NS(lock_billing_tenant=lambda *a, **k: None,
                            lock_subscription_by_tenant=lambda *a, **k: subscription),
              audit_service=NS(log=lambda *a, **k: None),
              _retrieve_live_period=lambda *a: (None, None),
              _send_payment_receipt_for_tenant=lambda *a, **k: None,
              _mark_event=lambda *a, **k: None)
    source_functions("backend/app/billing/service.py", ["_event_created_at", "_event_family", "_watermark", "_set_watermark", "_temporal_decision", "_process_temporal_event", "_clear_subscription_past_due"], ns)
    result = ns["_process_temporal_event"](None, event=NS(event_type="invoice.paid", stripe_event_id="evt_old_paid_synthetic"), event_payload={"created": 100}, stripe_object={"subscription": "sub_synthetic"}, tenant_id="synthetic")
    assert result == {"status": "processed"} and subscription.status == "active"
    print("CONFIRMED: canceled lifecycle(t=200) + invoice.paid(t=100) becomes active")


def reproduce_export_ops_note():
    class Rows:
        def __init__(self, columns=(), rows=()):
            self.columns, self.rows = columns, rows
        def keys(self): return self.columns
        def __iter__(self): return iter(self.rows)
        def scalars(self): return iter(["ops_notes"])
    class DB:
        def execute(self, query, *args):
            if "information_schema" in query: return Rows()
            if '"ops_notes"' in query: return Rows(["tenant_id", "body"], [("synthetic", "INTERNAL_SYNTHETIC_NOTE")])
            if "JOIN users" in query: return Rows(["email"])
            raise AssertionError(query)
        def get(self, *args): return None
    ns = dict(csv=csv, io=io, json=json, re=re, tempfile=tempfile,
              zipfile=zipfile, datetime=datetime, UTC=UTC, UUID=UUID,
              Decimal=Decimal, text=lambda q: q, Tenant=object,
              _SAFE_IDENTIFIER=re.compile(r"^[a-z_][a-z0-9_]*$"))
    source = ast.parse((ROOT / "backend/app/account_lifecycle/service.py").read_text(encoding="utf-8"))
    excluded = next(n.value for n in source.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_EXPORT_EXCLUDED_TABLES" for t in n.targets))
    ns["_EXPORT_EXCLUDED_TABLES"] = ast.literal_eval(excluded)
    source_functions("backend/app/account_lifecycle/service.py", ["_csv_value", "_write_csv_entry", "build_account_export"], ns)
    with ns["build_account_export"](DB(), tenant_id="synthetic") as output:
        with zipfile.ZipFile(output) as archive:
            assert "INTERNAL_SYNTHETIC_NOTE" in archive.read("datos/ops_notes.csv").decode()
    print("CONFIRMED: automatic account export includes tenant-linked internal ops_notes body")


if __name__ == "__main__":
    reproduce_stripe_cross_family()
    reproduce_export_ops_note()

```



## Código adicional ejecutado en PostgreSQL desechable

El siguiente script se guardó fuera del repositorio; requiere una base nueva con el nombre indicado y el PostgreSQL efímero descrito. No ejecutar contra una instancia compartida o producción. Resultados y límites se documentan en BILLING_AUTH_PRIVACY_REVIEW.md.

```python
import ast, os, sys, logging
from pathlib import Path
import psycopg
from sqlalchemy import create_engine,text
from sqlalchemy.orm import Session
from datetime import UTC,datetime,timedelta
from uuid import uuid4,UUID
root=Path('C:/Users/fkr2d/AppData/Local/Temp/kova-audit-5354139946cb4179ae437559bb4070c0/repo/backend')
assert not (root/'.env').exists()
with psycopg.connect('host=127.0.0.1 port=55469 user=pos dbname=postgres',autocommit=True) as conn:
    conn.execute('CREATE DATABASE kova_privacy_audit')
for cls in ast.parse((root/'app/config.py').read_text()).body:
    if isinstance(cls,ast.ClassDef) and cls.name=='Settings':
        for f in cls.body:
            if isinstance(f,ast.AnnAssign) and isinstance(f.target,ast.Name): os.environ.pop(f.target.id.upper(),None)
url='postgresql+psycopg://pos@127.0.0.1:55469/kova_privacy_audit'
os.environ.update(APP_ENV='local',DATABASE_URL=url,APP_DATABASE_URL=url,MIGRATION_DATABASE_URL=url,SECRET_KEY='isolated-audit-only-nonproduction-key')
os.chdir(root);sys.path.insert(0,str(root))
from alembic.config import Config
from alembic import command
command.upgrade(Config('alembic.ini'),'head')
from app.orders import service as orders
from app.orders.schemas import OrderCreate,RefundCreate
from app.account_lifecycle.service import purge_due_accounts
from app.account_lifecycle.models import AccountDeletionRequest
from app.observability.logging import JsonFormatter
engine=create_engine(url)
tenant,user,p1=uuid4(),uuid4(),uuid4()
with engine.begin() as conn:
    conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES (:t,'Synthetic Privacy',:slug)"),{'t':tenant,'slug':str(tenant)})
    conn.execute(text("INSERT INTO users(id,email,hashed_password,is_email_verified) VALUES (:u,:email,'synthetic-not-login-hash',true)"),{'u':user,'email':str(user)+'@example.invalid'})
    conn.execute(text("INSERT INTO memberships(id,tenant_id,user_id,role) VALUES (:id,:t,:u,'owner')"),{'id':uuid4(),'t':tenant,'u':user})
    conn.execute(text("INSERT INTO products(id,tenant_id,name,price_amount,track_inventory) VALUES (:p,:t,'Synthetic Product',5,false)"),{'p':p1,'t':tenant})
    conn.execute(text('GRANT USAGE ON SCHEMA public TO kova_app'))
    conn.execute(text('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO kova_app'))
body=OrderCreate(items=[{'product_id':p1,'quantity':1}],payments=[{'method':'bank_transfer','amount':'5.00'}])
with Session(engine) as db:
    _,sale=orders.create_order(db,tenant_id=tenant,user_id=user,body=body,idempotency_key='synthetic-expired')
    item=sale['items'][0]
    orders.create_refund(db,tenant_id=tenant,user_id=user,order_id=UUID(sale['id']),body=RefundCreate(items=[{'order_item_id':item['id'],'quantity':1}],reason='customer_return',refund_payment_method='bank_transfer'),idempotency_key='synthetic-refund')
    db.execute(text("UPDATE idempotency_keys SET expires_at=now()-interval '1 day' WHERE tenant_id=:t AND key='synthetic-expired'"),{'t':tenant});db.commit()
runtime=create_engine('postgresql+psycopg://kova_app@127.0.0.1:55469/kova_privacy_audit')
with Session(runtime) as db:
    db.execute(text("SELECT set_config('app.tenant_id',:t,true)"),{'t':str(tenant)})
    try:
        status,result=orders.create_order(db,tenant_id=tenant,user_id=user,body=body,idempotency_key='synthetic-expired')
        print('RUNTIME_EXPIRED_IDEMPOTENCY returned',status)
    except Exception as exc:
        print('RUNTIME_EXPIRED_IDEMPOTENCY',type(exc).__name__,type(getattr(exc,'orig',None)).__name__)
        db.rollback()
with Session(engine) as db:
    db.add(AccountDeletionRequest(tenant_id=tenant,requested_by_user_id=user,purge_after=datetime.now(UTC)-timedelta(days=1)));db.commit()
    try:
        print('PURGE_WITH_REFUND_RESULT',purge_due_accounts(db))
    except Exception as exc:
        orig=getattr(exc,'orig',None)
        print('PURGE_WITH_REFUND',type(exc).__name__,getattr(getattr(orig,'diag',None),'constraint_name',None))
        db.rollback()
    print('PURGE_AFTER_ROLLBACK',db.execute(text('SELECT count(*) FROM tenants WHERE id=:t'),{'t':tenant}).scalar(),'tenant retained')
    try:
        db.execute(text('DELETE FROM refunds WHERE tenant_id=:t'),{'t':tenant})
    except Exception as exc:
        print('DIRECT_REFUND_DELETE',getattr(getattr(getattr(exc,'orig',None),'diag',None),'constraint_name',None))
        db.rollback()
canary='SYNTHETIC-EMAIL@example.invalid'
with engine.connect() as conn:
    conn.execute(text('CREATE TEMP TABLE audit_canary (email text CHECK (false))'))
    try: conn.execute(text('INSERT INTO audit_canary(email) VALUES (:email)'),{'email':canary})
    except Exception:
        record=logging.LogRecord('audit',logging.ERROR,'synthetic',1,'database_error',(),sys.exc_info())
        rendered=JsonFormatter().format(record)
        print('LOG_CANARY_PRESENT',canary in rendered,'NO_REAL_PII_USED')
        conn.rollback()
engine.dispose();runtime.dispose()

```

