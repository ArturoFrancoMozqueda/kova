from unittest.mock import MagicMock
from uuid import uuid4

from app.tenants.models import Tenant
from scripts import set_customer_orders_feature as script


def _tenant() -> Tenant:
    return Tenant(
        id=uuid4(),
        name="Piloto Centro",
        slug=f"piloto-{uuid4().hex}",
        feature_overrides={"margin_reports": True},
    )


def test_dry_run_never_writes(monkeypatch, capsys) -> None:
    tenant = _tenant()
    db = MagicMock()
    db.scalar.return_value = tenant
    session_context = MagicMock()
    session_context.__enter__.return_value = db
    engine = MagicMock()
    monkeypatch.setattr(script, "create_engine", lambda *args, **kwargs: engine)
    monkeypatch.setattr(script, "Session", lambda *args, **kwargs: session_context)

    result = script.main(
        ["--tenant-id", str(tenant.id), "--enable", "--dry-run"]
    )

    assert result == 0
    assert tenant.feature_overrides == {"margin_reports": True}
    db.commit.assert_not_called()
    assert "dry_run=true" in capsys.readouterr().out


def test_exact_tenant_name_is_required_before_write(monkeypatch) -> None:
    tenant = _tenant()
    db = MagicMock()
    db.scalar.return_value = tenant
    session_context = MagicMock()
    session_context.__enter__.return_value = db
    engine = MagicMock()
    monkeypatch.setattr(script, "create_engine", lambda *args, **kwargs: engine)
    monkeypatch.setattr(script, "Session", lambda *args, **kwargs: session_context)

    result = script.main(
        [
            "--tenant-id",
            str(tenant.id),
            "--enable",
            "--confirm-tenant-name",
            "Otro negocio",
        ]
    )

    assert result == 3
    assert "customer_orders" not in tenant.feature_overrides
    db.commit.assert_not_called()


def test_enable_preserves_other_flags(monkeypatch) -> None:
    tenant = _tenant()
    db = MagicMock()
    db.scalar.return_value = tenant
    session_context = MagicMock()
    session_context.__enter__.return_value = db
    engine = MagicMock()
    monkeypatch.setattr(script, "create_engine", lambda *args, **kwargs: engine)
    monkeypatch.setattr(script, "Session", lambda *args, **kwargs: session_context)

    result = script.main(
        [
            "--tenant-id",
            str(tenant.id),
            "--enable",
            "--confirm-tenant-name",
            tenant.name,
        ]
    )

    assert result == 0
    assert tenant.feature_overrides == {
        "margin_reports": True,
        "customer_orders": True,
    }
    db.commit.assert_called_once()
