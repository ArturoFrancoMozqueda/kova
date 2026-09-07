#!/usr/bin/env python3
"""Read-only operational gates for the Kova audit remediation.

The repository check detects drift in local contracts. The restore preflight only
validates a dump and a disposable target; it never connects to a database.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
CANONICAL_SUPPORT_EMAIL = "posprojectsupport@gmail.com"
REQUIRED_EMAIL_SENDERS = (
    "send_verification_email",
    "send_welcome_email",
    "send_payment_receipt_email",
    "send_trial_ending_email",
    "send_password_reset_email",
)
PINNED_ACTION = re.compile(r"^\s*-?\s*uses:\s*[^\s@]+@[0-9a-f]{40}(?:\s+#\s*\S.*)?$")


def workflow_contract_errors(workflows: Path = WORKFLOWS) -> list[str]:
    """Return static workflow safety-contract violations without contacting GitHub."""
    errors: list[str] = []
    for path in sorted(workflows.glob("*.yml")):
        content = path.read_text(encoding="utf-8")
        if not re.search(r"(?m)^permissions:\s*(?:\{\})?\s*$", content):
            errors.append(f"workflow sin permisos explícitos mínimos: {path.name}")
        for line_number, line in enumerate(content.splitlines(), start=1):
            if "uses:" in line and not PINNED_ACTION.fullmatch(line):
                errors.append(
                    f"action sin SHA inmutable: {path.name}:{line_number}"
                )

    ci = (workflows / "ci.yml").read_text(encoding="utf-8")
    ci_markers = (
        "concurrency:",
        "format('{0}-{1}', github.workflow, github.ref)",
        "format('{0}-pr-{1}', github.workflow, github.event.pull_request.number)",
        "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    )
    for marker in ci_markers:
        if marker not in ci:
            errors.append(f"contrato de concurrencia CI faltante: {marker}")

    release_markers = (
        "e2e-mocked-dev:",
        "e2e-mocked-preview:",
        "npm run test:e2e-preview",
        "capture-release-state:",
        "release-rollback-",
        "recover-release:",
        "frontend/scripts/release-recovery.mjs",
        ".autoAssignCustomDomains",
        "--skip-domain",
    )
    for marker in release_markers:
        if marker not in ci:
            errors.append(f"contrato de release recuperable faltante: {marker}")

    drill_path = workflows / "release-recovery-drill.yml"
    if not drill_path.is_file():
        errors.append("contrato KOV-030 faltante: release-recovery-drill.yml")
    else:
        drill = drill_path.read_text(encoding="utf-8")
        drill_markers = (
            "workflow_dispatch:",
            "RUN_KOV030_STAGING_DRILL",
            "kova-kov030-${{ github.run_id }}-${{ github.run_attempt }}",
            "PRODUCTION_FLY_APP: pos-project-backend",
            "PRODUCTION_VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}",
            'test "$project_id" != "$PRODUCTION_VERCEL_PROJECT_ID"',
            "release-recovery.mjs --phase candidate",
            "release-recovery.mjs --phase promotion",
            "release-recovery.mjs --phase acceptance",
            "if: ${{ always() }}",
            'flyctl apps destroy "$STAGING_NAME" --yes',
            "--request DELETE",
            "Verify disposable resources are gone",
        )
        for marker in drill_markers:
            if marker not in drill:
                errors.append(f"contrato KOV-030 faltante: {marker}")
        for forbidden_trigger in ("push:", "pull_request:", "schedule:"):
            if re.search(rf"(?m)^  {forbidden_trigger}$", drill):
                errors.append(
                    f"KOV-030 no puede ejecutarse automáticamente: {forbidden_trigger}"
                )
        if "kovasuite.com" in drill:
            errors.append("KOV-030 no puede referenciar dominios de producción")

    fiscal = (workflows / "fiscal-global-drafts.yml").read_text(encoding="utf-8")
    fiscal_markers = (
        'cron: "23 */6 * * *"',
        "workflow_dispatch:",
        "permissions: {}",
        "group: fiscal-global-drafts",
        "cancel-in-progress: false",
        "-X POST",
        "X-Internal-Key: $INTERNAL_API_KEY",
        "--data '{\"tenant_limit\":100,\"periods_per_tenant\":31}'",
        "https://pos-project-backend.fly.dev/api/v1/fiscal/internal/global-drafts/auto-close",
        'if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then',
        "'tenants_examined'",
        "'batches_created'",
        "'batches_replayed'",
        "'periods_skipped_empty'",
        "'failures'",
        'if response["failures"]:',
    )
    for marker in fiscal_markers:
        if marker not in fiscal:
            errors.append(f"contrato scheduler fiscal faltante: {marker}")
    if re.search(r"echo\s+[\"']?\$INTERNAL_API_KEY", fiscal):
        errors.append("scheduler fiscal intenta imprimir INTERNAL_API_KEY")
    return errors


def _text(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def repository_errors() -> list[str]:
    """Return local OPS contract violations without accessing external systems."""
    errors: list[str] = []
    errors.extend(workflow_contract_errors())
    support = _text("frontend/src/lib/support.ts")
    if f'SUPPORT_EMAIL = "{CANONICAL_SUPPORT_EMAIL}"' not in support:
        errors.append("OPS-2: el canal canónico cambió sin evidencia del inbox de dominio")
    for path in ("frontend/src/routes/Home.tsx", "frontend/src/routes/LegalPage.tsx"):
        if "@/lib/support" not in _text(path):
            errors.append(f"OPS-2: {path} no usa la constante canónica de soporte")
    if CANONICAL_SUPPORT_EMAIL not in _text("docs/beta-agreement-template.md"):
        errors.append("OPS-6: el acuerdo beta no coincide con el soporte canónico")
    if f'email: "{CANONICAL_SUPPORT_EMAIL}"' not in _text("frontend/scripts/prerender.mjs"):
        errors.append("OPS-2: JSON-LD/prerender no coincide con el soporte canónico")

    email_service = _text("backend/app/email/service.py")
    for sender in REQUIRED_EMAIL_SENDERS:
        if f"def {sender}(" not in email_service:
            errors.append(f"OPS-1: falta la plantilla transaccional {sender}")

    config = _text("backend/app/config.py")
    match = re.search(r"account_deletion_grace_days:\s*int\s*=\s*(\d+)", config)
    if not match or int(match.group(1)) < 30:
        errors.append("OPS-5: la ventana de eliminación debe ser de al menos 30 días")

    required_markers = {
        ".github/workflows/db-backup.yml": ("RETENTION_DAYS", "pg_dump", "sha256sum"),
        ".github/workflows/account-purge.yml": ("workflow_dispatch", "X-Internal-Key"),
        "docs/runbooks/restore-supabase-backup.md": ("check_ops_readiness.py", "RTO", "RPO"),
        "docs/runbooks/shift-hygiene.md": ("No automatizar", "efectivo contado"),
        "docs/runbooks/ops-beta-gate.md": ("Outlook", "Hotmail", "asesoría legal"),
        "docs/account-lifecycle.md": ("7 días adicionales", "tenant desechable"),
    }
    for path, markers in required_markers.items():
        content = _text(path)
        for marker in markers:
            if marker not in content:
                errors.append(f"contrato OPS faltante en {path}: {marker}")
    return errors


def check_repository() -> int:
    errors = repository_errors()
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1
    print("OK: contratos locales OPS-1..OPS-6 consistentes (sin validar gates externos).")
    return 0


def validate_restore_target(
    *,
    restore_url: str,
    backup: Path,
    project_ref: str,
    production_project_ref: str,
    expected_sha256: str | None,
) -> list[str]:
    """Validate a restore target without making a network request."""
    errors: list[str] = []
    ref_pattern = re.compile(r"^[a-z0-9-]{6,64}$")
    if not ref_pattern.fullmatch(project_ref):
        errors.append("project-ref no tiene un formato válido")
    if not ref_pattern.fullmatch(production_project_ref):
        errors.append("production-project-ref no tiene un formato válido")
    if project_ref == production_project_ref:
        errors.append("el destino coincide con producción")

    parsed = urlparse(restore_url)
    if parsed.scheme not in {"postgresql", "postgres"}:
        errors.append("RESTORE_URL debe usar postgresql://")
    try:
        port = parsed.port
    except ValueError:
        port = None
    if port != 5432:
        errors.append("RESTORE_URL debe usar el session pooler en puerto 5432")
    hostname = (parsed.hostname or "").lower()
    if hostname != "supabase.com" and not hostname.endswith(".supabase.com"):
        errors.append("RESTORE_URL no parece apuntar a Supabase")
    if not parsed.username or not parsed.username.endswith(f".{project_ref}"):
        errors.append("el usuario de RESTORE_URL no coincide con project-ref")
    if parse_qs(parsed.query).get("sslmode", [""])[0] not in {"require", "verify-full"}:
        errors.append("RESTORE_URL debe exigir SSL")

    if not backup.is_file():
        errors.append("el dump no existe o no es un archivo")
    else:
        with backup.open("rb") as stream:
            if stream.read(5) != b"PGDMP":
                errors.append("el archivo no tiene cabecera de dump custom de PostgreSQL")
        if expected_sha256:
            hasher = hashlib.sha256()
            with backup.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    hasher.update(block)
            digest = hasher.hexdigest()
            if digest.lower() != expected_sha256.lower():
                errors.append("el SHA-256 del dump no coincide")
    return errors


def check_restore_preflight(args: argparse.Namespace) -> int:
    restore_url = os.environ.get("RESTORE_URL", "")
    if not args.ack_disposable_target:
        print("FAIL: falta --ack-disposable-target")
        return 1
    if not restore_url:
        print("FAIL: RESTORE_URL no está definida")
        return 1
    errors = validate_restore_target(
        restore_url=restore_url,
        backup=args.backup,
        project_ref=args.project_ref,
        production_project_ref=args.production_project_ref,
        expected_sha256=args.expected_sha256,
    )
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1
    print("OK: preflight local aprobado; no se realizó ninguna conexión ni restauración.")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("repository", help="comprueba contratos OPS locales")
    restore = commands.add_parser("restore-preflight", help="valida dump y destino sin conectar")
    restore.add_argument("--backup", type=Path, required=True)
    restore.add_argument("--project-ref", required=True)
    restore.add_argument("--production-project-ref", required=True)
    restore.add_argument("--expected-sha256")
    restore.add_argument("--ack-disposable-target", action="store_true")
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "repository":
        return check_repository()
    return check_restore_preflight(args)


if __name__ == "__main__":
    sys.exit(main())
