from __future__ import annotations

import hashlib
import importlib.util
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "check_ops_readiness.py"
SPEC = importlib.util.spec_from_file_location("check_ops_readiness", SCRIPT)
assert SPEC and SPEC.loader
OPS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OPS)


class RepositoryGateTests(unittest.TestCase):
    def test_current_repository_contracts_pass(self) -> None:
        self.assertEqual(OPS.repository_errors(), [])


class WorkflowContractTests(unittest.TestCase):
    def _workflows(self, directory: str) -> Path:
        target = Path(directory)
        ci_group = (
            "${{ github.event_name == 'push' "
            "&& format('{0}-{1}', github.workflow, github.ref) "
            "|| format('{0}-pr-{1}', github.workflow, "
            "github.event.pull_request.number) }}"
        )
        target.joinpath("ci.yml").write_text(
            textwrap.dedent(
                f"""\
                permissions: {{}}
                concurrency:
                  group: {ci_group}
                  cancel-in-progress: ${{{{ github.event_name == 'pull_request' }}}}
                e2e-mocked-dev:
                e2e-mocked-preview:
                  run: npm run test:e2e-preview
                capture-release-state:
                  project_setting: .autoAssignCustomDomains
                  artifact: release-rollback-
                deploy-vercel-preview:
                  run: vercel deploy --prebuilt --prod --skip-domain
                recover-release:
                  run: node frontend/scripts/release-recovery.mjs
                """
            ),
            encoding="utf-8",
        )
        scheduler_curl = (
            'curl -X POST -H "X-Internal-Key: $INTERNAL_API_KEY" '
            "--data '{\"tenant_limit\":100,\"periods_per_tenant\":31}' "
            "https://pos-project-backend.fly.dev/api/v1/fiscal/internal/"
            "global-drafts/auto-close"
        )
        required = (
            "{'tenants_examined', 'batches_created', 'batches_replayed', "
            "'periods_skipped_empty', 'failures'}"
        )
        target.joinpath("fiscal-global-drafts.yml").write_text(
            textwrap.dedent(
                f"""\
                on:
                  schedule:
                    - cron: "23 */6 * * *"
                  workflow_dispatch:
                permissions: {{}}
                concurrency:
                  group: fiscal-global-drafts
                  cancel-in-progress: false
                jobs:
                  prepare:
                    steps:
                      - run: |
                          {scheduler_curl}
                          if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
                              exit 1
                          fi
                          python - <<'PY'
                          required = {required}
                          if response["failures"]:
                              raise SystemExit(1)
                          PY
                """
            ),
            encoding="utf-8",
        )
        return target

    def test_accepts_pinned_actions_and_scheduler_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workflows = self._workflows(directory)
            workflows.joinpath("pinned.yml").write_text(
                "permissions: {}\nsteps:\n  - uses: owner/action@" + "a" * 40 + " # v1\n",
                encoding="utf-8",
            )
            errors = OPS.workflow_contract_errors(workflows)
        self.assertEqual(errors, [])

    def test_rejects_mutable_action_and_scheduler_without_failure_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workflows = self._workflows(directory)
            workflows.joinpath("mutable.yml").write_text(
                "steps:\n  - uses: owner/action@v1\n",
                encoding="utf-8",
            )
            fiscal = workflows.joinpath("fiscal-global-drafts.yml")
            fiscal.write_text(
                fiscal.read_text(encoding="utf-8").replace(
                    'if response["failures"]:', 'if False:'
                ),
                encoding="utf-8",
            )
            errors = OPS.workflow_contract_errors(workflows)
        self.assertTrue(any("permisos explícitos" in error for error in errors))
        self.assertTrue(any("action sin SHA" in error for error in errors))
        self.assertTrue(any("scheduler fiscal" in error for error in errors))

    def test_rejects_scheduler_that_prints_internal_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workflows = self._workflows(directory)
            fiscal = workflows.joinpath("fiscal-global-drafts.yml")
            fiscal.write_text(
                fiscal.read_text(encoding="utf-8") + 'echo "$INTERNAL_API_KEY"\n',
                encoding="utf-8",
            )
            errors = OPS.workflow_contract_errors(workflows)
        self.assertIn("scheduler fiscal intenta imprimir INTERNAL_API_KEY", errors)

    def test_rejects_release_without_phase_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workflows = self._workflows(directory)
            ci = workflows.joinpath("ci.yml")
            ci.write_text(
                ci.read_text(encoding="utf-8").replace(
                    "recover-release:", "recovery-removed:"
                ),
                encoding="utf-8",
            )
            errors = OPS.workflow_contract_errors(workflows)
        self.assertIn(
            "contrato de release recuperable faltante: recover-release:",
            errors,
        )

    def test_rejects_release_that_can_implicitly_move_vercel_domains(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workflows = self._workflows(directory)
            ci = workflows.joinpath("ci.yml")
            ci.write_text(
                ci.read_text(encoding="utf-8")
                .replace(".autoAssignCustomDomains", ".framework")
                .replace("--skip-domain", "--with-domain"),
                encoding="utf-8",
            )
            errors = OPS.workflow_contract_errors(workflows)
        self.assertIn(
            "contrato de release recuperable faltante: .autoAssignCustomDomains",
            errors,
        )
        self.assertIn(
            "contrato de release recuperable faltante: --skip-domain",
            errors,
        )


class RestorePreflightTests(unittest.TestCase):
    def _dump(self, directory: str) -> Path:
        dump = Path(directory) / "backup.dump"
        dump.write_bytes(b"PGDMP\x01fixture")
        return dump

    def test_accepts_disposable_supabase_session_pooler(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            errors = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.restore123:secret@aws.pooler.supabase.com:5432/"
                    "postgres?sslmode=require"
                ),
                backup=self._dump(directory),
                project_ref="restore123",
                production_project_ref="prod123",
                expected_sha256=None,
            )
        self.assertEqual(errors, [])

    def test_rejects_production_target_and_transaction_pooler(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            errors = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.prod123:secret@aws.pooler.supabase.com:6543/"
                    "postgres?sslmode=require"
                ),
                backup=self._dump(directory),
                project_ref="prod123",
                production_project_ref="prod123",
                expected_sha256=None,
            )
        self.assertIn("el destino coincide con producción", errors)
        self.assertIn("RESTORE_URL debe usar el session pooler en puerto 5432", errors)

    def test_rejects_non_dump_and_missing_ssl(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dump = Path(directory) / "backup.dump"
            dump.write_text("not a dump", encoding="utf-8")
            errors = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.restore123:secret@aws.pooler.supabase.com:5432/postgres"
                ),
                backup=dump,
                project_ref="restore123",
                production_project_ref="prod123",
                expected_sha256=None,
            )
        self.assertIn("RESTORE_URL debe exigir SSL", errors)
        self.assertIn("el archivo no tiene cabecera de dump custom de PostgreSQL", errors)

    def test_rejects_hostname_that_only_contains_supabase_name(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            errors = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.restore123:secret@supabase.com.attacker.test:5432/"
                    "postgres?sslmode=require"
                ),
                backup=self._dump(directory),
                project_ref="restore123",
                production_project_ref="prod123",
                expected_sha256=None,
            )
        self.assertIn("RESTORE_URL no parece apuntar a Supabase", errors)

    def test_verifies_expected_sha256(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dump = self._dump(directory)
            digest = hashlib.sha256(dump.read_bytes()).hexdigest()
            valid = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.restore123:secret@aws.pooler.supabase.com:5432/"
                    "postgres?sslmode=require"
                ),
                backup=dump,
                project_ref="restore123",
                production_project_ref="prod123",
                expected_sha256=digest,
            )
            invalid = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.restore123:secret@aws.pooler.supabase.com:5432/"
                    "postgres?sslmode=require"
                ),
                backup=dump,
                project_ref="restore123",
                production_project_ref="prod123",
                expected_sha256="0" * 64,
            )
        self.assertEqual(valid, [])
        self.assertIn("el SHA-256 del dump no coincide", invalid)


if __name__ == "__main__":
    unittest.main()
