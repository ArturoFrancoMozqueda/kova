"""add tenant feature overrides

Revision ID: 0046_tenant_feature_overrides
Revises: 0045_receipt_rls_empty_context
Create Date: 2026-07-17

The additive JSONB column supports gradual per-tenant rollout. It contains no
tenant identifier and remains protected by the existing tenants-table RLS
policy; application code exposes only explicitly supported boolean flags.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0046_tenant_feature_overrides"
down_revision: str | None = "0045_receipt_rls_empty_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "feature_overrides",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("tenants", "feature_overrides")
