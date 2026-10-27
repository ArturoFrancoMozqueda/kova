"""Read-only proof of billing reconciliation bypass using actual AST functions.

Run from repository root:
    backend/.venv/bin/python docs/audits/evidence/KOVA-SECURITY-BILLING-2026-10-26.py
No app imports, dotenv reads, database connections, HTTP, or live credentials.
Only repository and external Stripe I/O are simulated; business functions are
compiled unchanged from the audited baseline commit. This historical evidence
does not test the corrected working tree; its regression tests live in
backend/app/tests/test_billing_checkout_reconciliation_security.py.
"""
import ast
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace as NS
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[3]
BASELINE = '22dce337b277e2389555f90e752ec87db95da185'
SERVICE_FUNCTIONS = {
    '_now_utc', '_stripe_secret_key', '_timestamp', '_extract_period',
    '_retrieve_live_period', '_subscription_status', '_clear_subscription_past_due',
    '_upsert_subscription_from_stripe_object', '_tenant_id_from_event_object',
    '_set_watermark', 'get_subscription_status', 'reconcile_checkout_session',
}
namespace = dict(UTC=UTC, datetime=datetime, timedelta=timedelta, UUID=UUID, dataclass=dataclass)
for filename, selected in [
    ('service.py', SERVICE_FUNCTIONS),
    ('access.py', {'BillingAccessStatus', '_as_utc', 'get_billing_access_status', 'serialize_billing_access'}),
]:
    source_path = f'backend/app/billing/{filename}'
    source = subprocess.run(
        ['git', 'show', f'{BASELINE}:{source_path}'], cwd=ROOT,
        check=True, capture_output=True, text=True,
    ).stdout
    tree = ast.parse(source)
    nodes = [node for node in tree.body
             if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in selected]
    module = ast.Module(body=[ast.ImportFrom(module='__future__',
        names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), f'{BASELINE}:{source_path}', 'exec'), namespace)

namespace.update(
    settings=NS(stripe_secret_key='synthetic-test-only', billing_trial_days=7),
    EVENT_FAMILY_LIFECYCLE='lifecycle', BILLING_RECOVERY_PATH='/settings/billing',
    STANDARD_PLAN_NAME='Standard Plan', STANDARD_PLAN_AMOUNT_MINOR_UNITS=29900,
    STANDARD_PLAN_CURRENCY='MXN', STANDARD_PLAN_INTERVAL='month',
    StripeSubscriptionError=RuntimeError, StripeCheckoutError=RuntimeError,
    audit_service=NS(log=lambda *args, **kwargs: None),
    _send_welcome_email_for_tenant=lambda *args, **kwargs: None,
    forbidden=lambda message: RuntimeError(message), HTTPException=RuntimeError,
)

for live_status, payment_status in [('canceled', 'paid'), ('unpaid', 'paid'), ('incomplete', 'unpaid')]:
    tenant_id = uuid4()
    now = datetime.now(UTC)
    past = now - timedelta(days=60)
    row = NS(id=uuid4(), tenant_id=tenant_id, status=live_status,
        stripe_subscription_id='sub_historical', stripe_customer_id='cus_synthetic',
        current_period_start=past, current_period_end=past + timedelta(days=30),
        latest_checkout_session_id='cs_historical', grace_period_ends_at=None,
        past_due_at=None, trial_ends_at=None)
    repo = NS(get_subscription_by_tenant=lambda *args, **kwargs: row,
        lock_subscription_by_tenant=lambda *args, **kwargs: row)
    namespace['repository'] = repo
    namespace['billing_repo'] = repo
    namespace['checkout_client'] = NS(retrieve_session=lambda **kwargs: {
        'id': 'cs_historical', 'object': 'checkout.session', 'mode': 'subscription',
        'customer': 'cus_synthetic', 'subscription': 'sub_historical',
        'payment_status': payment_status, 'status': 'complete',
        'metadata': {'tenant_id': str(tenant_id)},
    })
    retrieved = []
    def retrieve(**kwargs):
        retrieved.append(kwargs['stripe_subscription_id'])
        return {'id': 'sub_historical', 'status': live_status,
            'current_period_start': int(past.timestamp()),
            'current_period_end': int((past + timedelta(days=30)).timestamp())}
    namespace['subscription_client'] = NS(retrieve=retrieve)
    db = NS(flush=lambda: None, commit=lambda: None)
    before = namespace['get_billing_access_status'](db, tenant_id=tenant_id).allowed
    result = namespace['reconcile_checkout_session'](db, tenant_id=tenant_id,
        user_id=uuid4(), session_id='cs_historical')
    assert before is False
    assert row.status == 'active' and result['access']['allowed'] is True
    assert row.current_period_end < now and retrieved == ['sub_historical']
    print({'stripe_subscription_status': live_status,
        'checkout_payment_status': payment_status, 'before_allowed': before,
        'after_status': row.status, 'after_allowed': result['access']['allowed'],
        'expired_period': True, 'current_stripe_status_retrieved_but_ignored': True})
