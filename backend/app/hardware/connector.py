#!/usr/bin/env python3
"""Kova drawer bridge. Python 3.12+, standard library only; no inbound server.

Run `python kova-drawer-connector.py setup` then `python ... run`.
The enrollment code is entered privately, never as a command-line argument.
"""

# ruff: noqa: T201 -- Standalone connector intentionally reports status to its operator.
import argparse
import getpass
import json
import os
import socket
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID

DEFAULT_API = "https://api.kovasuite.com"
CONFIG = Path.home() / ".kova-drawer" / "connector.json"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the device credential to another origin.
        raise ValueError("El servidor no debe redirigir la conexión")


def validate_api(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError("La dirección de Kova debe usar HTTPS y no incluir rutas")
    return value.rstrip("/")


def api(config: dict, path: str, body: dict) -> dict:
    headers = {"Content-Type": "application/json"}
    if config.get("device_key"):
        headers["X-Kova-Device-Key"] = config["device_key"]
    request = Request(
        validate_api(config["api"]) + "/api/v1/hardware/connector" + path,
        data=json.dumps(body).encode(),
        headers=headers,
        method="POST",
    )
    with build_opener(NoRedirect()).open(request, timeout=4) as response:
        return json.loads(response.read(65536))


def pulse(pin: int) -> bytes:
    if type(pin) is not int or pin not in (0, 1):
        raise ValueError("Salida de cajón inválida")
    # ESC p: pin 2/5, 100ms ON / 400ms OFF. No text, cut or arbitrary commands.
    return bytes((27, 112, pin, 50, 200))


def send(config: dict, data: bytes, deadline: float) -> None:
    # Direct transport only: OS spoolers can retain a pulse and execute it long
    # after printer recovery, defeating the command's expiry.
    with socket.create_connection((config["host"], config["port"]), timeout=1) as connection:
        if time.monotonic() >= deadline:
            raise TimeoutError("La orden venció antes de conectar con la impresora")
        connection.settimeout(min(1, deadline - time.monotonic()))
        connection.sendall(data)


def process(config: dict, command: dict, received_at: float) -> str:
    UUID(command["id"])
    expiry = datetime.fromisoformat(command["expires_at"].replace("Z", "+00:00"))
    if (
        expiry <= datetime.now(UTC)
        or time.monotonic() - received_at > 2
        or not 0 < command.get("ttl_ms", 0) <= 4000
    ):
        return "failed"
    try:
        remaining = (expiry - datetime.now(UTC)).total_seconds()
        deadline = min(received_at + 2, time.monotonic() + remaining)
        send(config, pulse(command["pin"]), deadline)
        return "sent"
    except (OSError, ValueError):
        # Never retry a pulse: a partial write might already have opened it.
        return "failed"


def setup(args) -> None:
    config = {"api": validate_api(args.api)}
    if not args.host or not 1 <= args.port <= 65535:
        raise ValueError("Indica --host y un puerto válido para la impresora de red")
    config.update(host=args.host, port=args.port)
    code = getpass.getpass("Código de vinculación de Kova: ")
    result = api(config, "/pair", {"code": code})
    config["device_key"] = result["device_key"]
    CONFIG.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # No key in stdout, CLI history or environment variables.
    fd = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.chmod(CONFIG, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump(config, output)
    print("Conector vinculado. Ejecuta el comando run y prueba el cajón desde Kova.")


def run() -> None:
    config = json.loads(CONFIG.read_text())
    validate_api(config["api"])
    print("Conector activo. Mantén este proceso abierto junto a la caja.")
    while True:
        try:
            started = time.monotonic()
            result = api(config, "/poll", {})
            for command in result["commands"]:
                outcome = process(config, command, started)
                # ACK retries are safe, physical pulses never are. A lost ACK
                # leaves an uncertain status in Kova and needs manual inspection.
                api(config, f"/commands/{command['id']}/ack", {"status": outcome})
        except HTTPError as error:
            if error.code in (401, 403):
                print("Conector detenido. Revisa la vinculación y el acceso del negocio en Kova.")
                return
            print("Conexión interrumpida. Las órdenes vencidas no se ejecutarán.")
            time.sleep(3)
        except (OSError, ValueError, KeyError):
            print("Conexión interrumpida. Las órdenes vencidas no se ejecutarán.")
            time.sleep(3)
        time.sleep(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Conector de cajón de dinero de Kova")
    commands = parser.add_subparsers(dest="command", required=True)
    install = commands.add_parser("setup", help="Vincular este equipo con una sucursal")
    install.add_argument("--api", default=DEFAULT_API)
    install.add_argument("--host", help="Dirección local de la impresora ESC/POS")
    install.add_argument("--port", type=int, default=9100)
    commands.add_parser("run", help="Esperar órdenes de apertura de Kova")
    args = parser.parse_args()
    try:
        setup(args) if args.command == "setup" else run()
    except KeyboardInterrupt:
        print("Conector detenido.")
    except (OSError, ValueError, KeyError):
        print("No se pudo iniciar el conector. Revisa la configuración y vuelve a vincularlo.")
        sys.exit(1)


if __name__ == "__main__":
    main()
