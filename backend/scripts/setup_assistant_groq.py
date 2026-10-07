"""Capture an operator-supplied key without echo, arguments, or tracked files."""

import getpass
import os
import re
from pathlib import Path


def main():
    destination = Path(__file__).resolve().parents[1] / ".env.groq.local"
    if destination.exists() or destination.is_symlink():
        raise SystemExit("La configuración local ya existe; no se sobrescribió.")
    key = getpass.getpass("Pega la clave de Groq (entrada oculta): ").strip()
    if not re.fullmatch(r"gsk_[A-Za-z0-9_-]{20,}", key):
        raise SystemExit("Formato de clave no válido. No se guardó ningún archivo.")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(destination, flags, 0o600)
    with os.fdopen(descriptor, "w") as target:
        target.write(
            f"ASSISTANT_GROQ_API_KEY={key}\n"
            "ASSISTANT_GENERATION_PROVIDER=groq\n"
            "ASSISTANT_GROQ_MODEL=openai/gpt-oss-20b\n"
            "ASSISTANT_GROQ_QUALITY_VERIFIED=false\n"
        )
    print("Clave guardada con permisos privados. La inferencia sigue sin activar.")


if __name__ == "__main__":
    main()
