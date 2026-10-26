"""Verify one server-configured account; never accept tokens on the command line."""

import argparse
import sys
from pathlib import Path
from uuid import UUID

sys.path.append(str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.db import PrivilegedSessionLocal  # noqa: E402
from app.messaging.connections import configured_connections  # noqa: E402
from app.messaging.provisioning import provision_binding, verify_account  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Verifica una conexión de WhatsApp del piloto")
    parser.add_argument("--binding-id", required=True, type=UUID)
    parser.add_argument(
        "--authorized-by",
        required=True,
        type=UUID,
        help="Dueño o gerente activo que autorizó la conexión",
    )
    parser.add_argument("--apply", action="store_true", help="Confirma la vinculación verificada")
    args = parser.parse_args()
    try:
        connection = next(
            row for row in configured_connections() if row.binding_id == args.binding_id
        )
        verify_account(connection, transport=httpx.HTTPTransport(retries=0))
        if args.apply:
            with PrivilegedSessionLocal() as db:
                provision_binding(db, connection, authorized_by=args.authorized_by)
                db.commit()
            print("Vinculación verificada y guardada. El envío requiere habilitación separada.")
        else:
            print("Número verificado ante Meta. No se modificó la vinculación de Kova.")
    except Exception:
        # Neither HTTP/DB errors nor validation input can print provider secrets.
        raise SystemExit(
            "No se pudo verificar la conexión. Revisa el alcance y la configuración."
        ) from None


if __name__ == "__main__":
    main()
