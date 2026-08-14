import argparse
import difflib
import json
import os
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

# Schema generation must not require production credentials or contact external
# services. CI can still override this explicitly.
os.environ.setdefault("APP_ENV", "local")

from app.main import app as fastapi_app  # noqa: E402, I001


DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "specs" / "openapi.json"


def _render_schema() -> str:
    return json.dumps(fastapi_app.openapi(), indent=2, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Exporta o verifica el contrato OpenAPI de Kova")
    parser.add_argument(
        "--check", action="store_true", help="falla si el contrato versionado cambió"
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    rendered = _render_schema()
    if args.check:
        if not args.output.exists():
            raise SystemExit(f"Falta el contrato versionado: {args.output}")
        current = args.output.read_text(encoding="utf-8")
        if current != rendered:
            diff = difflib.unified_diff(
                current.splitlines(),
                rendered.splitlines(),
                fromfile=str(args.output),
                tofile="OpenAPI generado",
                n=2,
            )
            preview = "\n".join(list(diff)[:200])
            raise SystemExit(
                "El contrato OpenAPI cambió. Revisa el cambio y ejecuta "
                "'uv run python scripts/export_openapi.py' para aceptarlo explícitamente.\n"
                + preview
            )
        return

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    print(f"OpenAPI exportado a {args.output}")


if __name__ == "__main__":
    main()
