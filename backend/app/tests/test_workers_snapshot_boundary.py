"""Snapshot metadata is pure; runtime engines retain the same declarative registry."""

import ast
import subprocess
import sys
import textwrap
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
ENTRY = BACKEND.parent / "deploy/cloudflare-backend/entry.py"


def _inventory():
    return {
        node.targets[0].id: ast.literal_eval(node.value)
        for node in ast.parse(ENTRY.read_text()).body
        if isinstance(node, ast.Assign)
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id in {"_MODEL_MODULES", "_SCHEMA_MODULES"}
    }


def test_entry_preloads_metadata_without_transport_sdks_or_runtime_state():
    # Execute the real entry, rather than just its inventory, in a fresh process.
    # Transport SDKs must load in invocation bootstrap, after the shared snapshot.
    script = """
import importlib.abc
import runpy
import socket
import sys
import types

class SnapshotImportDenied(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'pg8000', 'sentry_sdk', 'httpx'} or fullname in {'app.config', 'app.db'}:
            raise AssertionError('Entry crossed snapshot boundary: ' + fullname)

def refuse(*args, **kwargs):
    raise AssertionError('Entry attempted network I/O')

workers = types.ModuleType('workers')
workers.DurableObject = type('DurableObject', (), {})
workers.WorkerEntrypoint = type('WorkerEntrypoint', (), {})
sys.modules['workers'] = workers
sys.meta_path.insert(0, SnapshotImportDenied())
socket.socket.connect = refuse
socket.create_connection = refuse
entry = runpy.run_path(ENTRY)
from app.orm_metadata import Base
assert Base.metadata.tables
for name in (*entry['_MODEL_MODULES'], *entry['_SCHEMA_MODULES']):
    assert name in sys.modules
assert 'app.config' not in sys.modules and 'app.db' not in sys.modules
"""
    result = subprocess.run(
        [sys.executable, "-c", "ENTRY = " + repr(str(ENTRY)) + "\n" + textwrap.dedent(script)],
        cwd=BACKEND,
        env={"PATH": str(Path(sys.executable).parent)},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_snapshot_inventory_covers_model_schema_files_without_runtime_modules():
    # DTOs declared in runtime modules such as branches.reports/messaging.readiness
    # intentionally stay outside this filename inventory and may import settings.
    inventory = _inventory()
    for key, pattern in (("_MODEL_MODULES", "*models.py"), ("_SCHEMA_MODULES", "*schemas.py")):
        expected = {
            "app." + ".".join(path.relative_to(BACKEND / "app").with_suffix("").parts)
            for path in (BACKEND / "app").rglob(pattern)
            if "tests" not in path.parts
        }
        assert set(inventory[key]) == expected
        assert len(inventory[key]) == len(set(inventory[key]))
    modules = (*inventory["_MODEL_MODULES"], *inventory["_SCHEMA_MODULES"])
    script = """
import importlib
import importlib.abc
import socket
import sys
import sqlalchemy
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session

class RuntimeImportDenied(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in {"app.config", "app.db"} or fullname.startswith(("app.config.", "app.db.")):
            raise AssertionError("Snapshot crossed runtime boundary: " + fullname)

def refuse(*args, **kwargs):
    raise AssertionError("Snapshot attempted engine, session or network I/O")

sys.meta_path.insert(0, RuntimeImportDenied())
sqlalchemy.create_engine = refuse
Engine.__init__ = refuse
Connection.__init__ = refuse
Session.__init__ = refuse
socket.socket.connect = refuse
socket.create_connection = refuse
for name in MODULES:
    importlib.import_module(name)
from app.orm_metadata import Base
assert Base.metadata.tables
assert "app.config" not in sys.modules
assert "app.db" not in sys.modules
"""
    result = subprocess.run(
        [sys.executable, "-c", "MODULES = " + repr(modules) + "\n" + textwrap.dedent(script)],
        cwd=BACKEND,
        env={"PATH": str(Path(sys.executable).parent)},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_runtime_base_reexport_preserves_registry_and_table_metadata():
    from app.db import Base as RuntimeBase
    from app.orm_metadata import Base

    assert RuntimeBase is Base
    assert Base.registry.mappers
    for mapper in Base.registry.mappers:
        assert mapper.registry is Base.registry
        assert mapper.local_table.metadata is Base.metadata
        assert Base.metadata.tables[mapper.local_table.key] is mapper.local_table


def test_router_bound_transfer_model_joins_same_registry_after_configuration(tmp_path):
    # transfers.py also defines routes/services and intentionally stays outside the
    # pure *models.py/*schemas.py preload inventory. Do not extract that domain.
    inventory = _inventory()
    assert "app.branches.transfers" not in inventory["_MODEL_MODULES"]
    modules = (*inventory["_MODEL_MODULES"], *inventory["_SCHEMA_MODULES"])
    script = """
import importlib
import sys
from types import SimpleNamespace
for module in MODULES:
    importlib.import_module(module)
from app.orm_metadata import Base
assert "app.config" not in sys.modules and "app.db" not in sys.modules
assert "inventory_transfers" not in Base.metadata.tables
from app.workers import bootstrap
# The sync adapter belongs to WASM; this subprocess checks the native registry.
bootstrap.install_sync_adapter = lambda: None
bootstrap.configure(SimpleNamespace(
    APP_ENV="local",
    APP_DATABASE_URL="postgresql+psycopg://synthetic:synthetic@127.0.0.1/unused",
), privileged=False)
from app.db import Base as RuntimeBase
from app import db as runtime_db
from app.branches import scope as branch_scope
from app.branches.transfers import InventoryTransfer
from sqlalchemy import event
from sqlalchemy.orm import Session
assert event.contains(Session, "after_begin", runtime_db._restore_transaction_tenant_context)
assert event.contains(Session, "do_orm_execute", branch_scope._filter_branch)
assert event.contains(Session, "before_flush", branch_scope._stamp_branch)
assert RuntimeBase is Base
assert issubclass(InventoryTransfer, Base)
assert InventoryTransfer.__table__.metadata is Base.metadata
assert Base.metadata.tables["inventory_transfers"] is InventoryTransfer.__table__
"""
    result = subprocess.run(
        [sys.executable, "-c", "MODULES = " + repr(modules) + "\n" + textwrap.dedent(script)],
        cwd=tmp_path,
        env={"PATH": str(Path(sys.executable).parent), "PYTHONPATH": str(BACKEND)},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
