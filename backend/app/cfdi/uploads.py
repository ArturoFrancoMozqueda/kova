"""Bounded, in-memory multipart parsing; no temporary certificate files."""

from email import policy
from email.parser import BytesParser

from fastapi import Request

from app.shared.exceptions import bad_request

MAX_BODY_BYTES = 150 * 1024
MAX_FILE_BYTES = 64 * 1024


def parse_certificate(content_type: str, body: bytes):
    if len(body) > MAX_BODY_BYTES or "\r" in content_type or "\n" in content_type:
        raise bad_request("Los certificados exceden el tamaño permitido")
    if not content_type.lower().startswith("multipart/form-data;"):
        raise bad_request("Carga los archivos .cer y .key de tu CSD")
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii") + body
    )
    if message.defects or not message.is_multipart():
        raise bad_request("No pudimos leer los archivos del CSD")
    values = {}
    for part in message.iter_parts():
        field = part.get_param("name", header="content-disposition")
        if part.defects or part.is_multipart() or field not in ("cer", "key", "password"):
            raise bad_request("El formulario del CSD contiene campos inválidos")
        if field in values or part.get("Content-Transfer-Encoding"):
            raise bad_request("El formulario del CSD contiene campos duplicados o inválidos")
        data = part.get_payload(decode=True)
        if not isinstance(data, bytes) or not data:
            raise bad_request("Completa los archivos y la contraseña del CSD")
        filename = part.get_filename()
        if field == "password":
            if filename is not None or len(data) > 1024:
                raise bad_request("La contraseña del CSD no es válida")
            decoded = None
            try:
                decoded = data.decode("utf-8")
            except UnicodeError:
                pass
            if decoded is None:
                raise bad_request("La contraseña del CSD no es válida")
            values[field] = decoded
        else:
            if (
                not filename
                or not filename.lower().endswith("." + field)
                or len(data) > MAX_FILE_BYTES
            ):
                raise bad_request("Cada archivo .cer o .key debe medir como máximo 64 KB")
            values[field] = data
    if set(values) != {"cer", "key", "password"}:
        raise bad_request("Completa los archivos .cer, .key y la contraseña del CSD")
    return values["cer"], values["key"], values["password"]


async def read_certificate(request: Request):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BODY_BYTES:
            raise bad_request("Los certificados exceden el tamaño permitido")
    try:
        return parse_certificate(request.headers.get("content-type", ""), bytes(body))
    except UnicodeError:
        raise bad_request("El formulario del CSD no es válido") from None
