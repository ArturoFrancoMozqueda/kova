"""Bounded canonical Kova CSV, not a parser for any bank's proprietary format."""

import csv
import hashlib
import io
import json
import re
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from app.reconciliation.schemas import PreviewRow, ReconciliationPreviewResponse, RowError
from app.shared.exceptions import bad_request

HEADER = [
    "settled_at",
    "gross_amount",
    "fee_amount",
    "net_amount",
    "currency",
    "payment_method",
    "reference",
]


def _amount(value):
    if not re.fullmatch(r"\d{1,10}(?:\.\d{1,2})?", value):
        raise ValueError("Importe inválido: usa MXN con máximo dos decimales")
    try:
        amount = Decimal(value)
    except InvalidOperation:
        raise ValueError("Importe inválido") from None
    if not amount.is_finite() or amount > Decimal("9999999999.99"):
        raise ValueError("Importe fuera de rango")
    return amount.quantize(Decimal("0.01"))


def preview(content: str) -> ReconciliationPreviewResponse:
    if len(content.encode("utf-8")) > 262144 or "\x00" in content:
        raise bad_request("El CSV debe ser texto UTF-8 de máximo 256 KiB")
    try:
        reader = csv.reader(io.StringIO(content.lstrip("\ufeff")), strict=True)
        if next(reader, None) != HEADER:
            raise bad_request("Columnas inválidas. Usa el formato CSV manual de Kova")
        rows, errors, seen = [], [], set()
        for number, values in enumerate(reader, start=2):
            if number > 501:
                raise bad_request("El CSV admite máximo 500 filas")
            try:
                if len(values) != len(HEADER):
                    raise ValueError("La fila no tiene las siete columnas requeridas")
                values = [value.strip() for value in values]
                if any(value.startswith(("=", "+", "@", "-")) for value in values):
                    raise ValueError("No se permiten fórmulas ni valores ejecutables")
                settled = datetime.fromisoformat(values[0].replace("Z", "+00:00"))
                if settled.tzinfo is None or settled.utcoffset() is None:
                    raise ValueError("La fecha debe incluir zona horaria")
                gross, fee, net = (_amount(value) for value in values[1:4])
                if gross <= 0 or net <= 0 or fee < 0 or gross - fee != net:
                    raise ValueError("El bruto menos la comisión debe igualar el neto positivo")
                if values[4] != "MXN" or values[5] not in {"bank_transfer", "manual_card"}:
                    raise ValueError("Sólo MXN y métodos bank_transfer/manual_card")
                reference = values[6]
                # Only an already masked reference is accepted, not raw bank/card data.
                if (
                    len(reference) > 64
                    or not re.fullmatch(r"\*{3,}[A-Za-z0-9-]{0,16}", reference)
                    or re.search(r"\d{5}", reference)
                ):
                    raise ValueError("Usa una referencia ya enmascarada, por ejemplo ***1234")
                normalized = {
                    "settled_at": settled.astimezone(UTC).isoformat(),
                    "gross_amount": str(gross),
                    "fee_amount": str(fee),
                    "net_amount": str(net),
                    "currency": "MXN",
                    "payment_method": values[5],
                    "external_reference_masked": reference,
                }
                fingerprint = hashlib.sha256(
                    json.dumps(normalized, sort_keys=True).encode()
                ).hexdigest()
                if fingerprint in seen:
                    raise ValueError("La fila está duplicada en este archivo")
                seen.add(fingerprint)
                rows.append(
                    PreviewRow(row_number=number, row_fingerprint=fingerprint, **normalized)
                )
            except (ValueError, OverflowError):
                # Do not echo potentially sensitive cell contents in errors or logs.
                errors.append(
                    RowError(
                        row_number=number,
                        message=(
                            "Fila inválida: revisa fecha con zona, importes, MXN, "
                            "método y referencia enmascarada"
                        ),
                    )
                )
    except csv.Error:
        raise bad_request("CSV inválido: revisa las comillas y columnas") from None
    if not rows and not errors:
        raise bad_request("El CSV no contiene liquidaciones")
    checksum = hashlib.sha256("|".join(row.row_fingerprint for row in rows).encode()).hexdigest()
    return ReconciliationPreviewResponse(content_sha256=checksum, rows=rows, errors=errors)
