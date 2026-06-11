"""orders.status CHECK constraint (no-op)

Originally this migration added a CHECK constraint `ck_orders_status` on
orders.status. That was redundant: `0010_refund_void_constraints` already
creates the identical constraint (status IN ('completed','voided')), so running
the full chain on a clean database failed with DuplicateObject.

This revision is kept as a no-op (it was already published as head) so the
revision chain and any database already stamped at 0032 stay valid. The intent
— a DB-level guard on orders.status — is satisfied by 0010, and the ORM model
now declares the same constraint in __table_args__ to keep model and schema in
sync.

Revision ID: 0032_orders_status_check
Revises: 0031_audit_log_indexes
Create Date: 2026-06-11 00:00:00.000000
"""

from collections.abc import Sequence

revision: str = "0032_orders_status_check"
down_revision: str | None = "0031_audit_log_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # No-op: ck_orders_status already exists from 0010_refund_void_constraints.
    pass


def downgrade() -> None:
    # No-op: the constraint is owned by 0010's down-revision, not this one.
    pass
