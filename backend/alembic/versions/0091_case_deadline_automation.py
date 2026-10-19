"""Opt-in internal review of service-case deadlines; no additional storage."""

from alembic import op

revision = "0091_case_deadline_automation"
down_revision = "0090_service_cases"
branch_labels = None
depends_on = None

RULE_OLD = "template_key IN ('order_ready', 'order_fulfilled', 'restock_review')"
RULE_NEW = (
    "template_key IN ('order_ready', 'order_fulfilled', 'restock_review', 'service_case_overdue')"
)
EVENT_OLD = (
    "event_type IN ('customer_order.ready', 'customer_order.fulfilled', "
    "'customer_order.cancelled', 'inventory.restock_review')"
)
EVENT_NEW = (
    "event_type IN ('customer_order.ready', 'customer_order.fulfilled', "
    "'customer_order.cancelled', 'inventory.restock_review', 'service_case.review_due')"
)


def _replace(rule, event):
    op.drop_constraint("ck_automation_rule_template", "automation_rules", type_="check")
    op.create_check_constraint("ck_automation_rule_template", "automation_rules", rule)
    op.drop_constraint("ck_business_event_type", "business_events", type_="check")
    op.create_check_constraint("ck_business_event_type", "business_events", event)


def upgrade():
    _replace(RULE_NEW, EVENT_NEW)


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM automation_rules WHERE template_key='service_case_overdue')
           OR EXISTS (SELECT 1 FROM business_events WHERE event_type='service_case.review_due')
           OR EXISTS (SELECT 1 FROM automation_runs WHERE template_key='service_case_overdue') THEN
            RAISE EXCEPTION 'Cannot discard service case deadline automation history';
        END IF;
    END $$""")
    _replace(RULE_OLD, EVENT_OLD)
