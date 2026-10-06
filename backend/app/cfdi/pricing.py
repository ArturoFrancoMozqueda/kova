from decimal import ROUND_HALF_UP, Decimal

from app.cfdi.schemas import InvoicePreparation, PreviewLine, PreviewResponse
from app.integrations.models import InvoiceRequest
from app.orders.models import Order, OrderItem
from app.pricing.calculator import money
from app.shared.exceptions import bad_request

SIX = Decimal("0.000001")
RATES = {
    "iva16": Decimal("0.16"),
    "iva8": Decimal("0.08"),
    "iva0": Decimal(0),
    "exempt": Decimal(0),
    "not_subject": Decimal(0),
}


def six(value: Decimal) -> Decimal:
    return value.quantize(SIX, rounding=ROUND_HALF_UP)


def prepare(
    request: InvoiceRequest, order: Order, items: list[OrderItem], body: InvoicePreparation
):
    classifications = {line.order_item_id: line for line in body.lines}
    if len(classifications) != len(body.lines) or set(classifications) != {
        item.id for item in items
    }:
        raise bad_request("Clasifica cada concepto de la venta exactamente una vez")
    lines = []
    provider_items = []
    for item in items:
        classification = classifications[item.id]
        rate = RATES[classification.tax_kind]
        if item.tax_amount and (classification.tax_included or not rate):
            raise bad_request("El impuesto adicional cobrado debe declararse como IVA no incluido")
        if not item.tax_amount and not classification.tax_included and rate:
            raise bad_request(
                "Esta venta no cobró IVA adicional; declara IVA incluido o una tasa sin importe"
            )
        divisor = Decimal(1) + rate if classification.tax_included else Decimal(1)
        # Normalize the provider product to before-tax values. The original
        # inclusive choice remains visible in preview; no implicit IVA is assumed.
        price = six(item.unit_price_amount / divisor)
        gross = six(price * item.quantity)
        discount = six(item.discount_amount / divisor)
        net = six(gross - discount)
        tax = six(net * rate)
        total = six(net + tax)
        if money(total) != item.line_total_amount:
            raise bad_request("La clasificación fiscal no concilia con el importe de cada concepto")
        lines.append(
            PreviewLine(
                order_item_id=item.id,
                product_name=item.product_name,
                quantity=item.quantity,
                product_key=classification.product_key,
                unit_key=classification.unit_key,
                tax_kind=classification.tax_kind,
                tax_included=classification.tax_included,
                unit_price_amount=price,
                gross_amount=gross,
                discount_amount=discount,
                tax_amount=tax,
                total_amount=total,
            )
        )
        taxes = (
            []
            if classification.tax_kind == "not_subject"
            else [{"type": "IVA", "factor": "Exento", "rate": Decimal(0)}]
            if classification.tax_kind == "exempt"
            else [{"type": "IVA", "factor": "Tasa", "rate": rate}]
        )
        provider_items.append(
            {
                "quantity": item.quantity,
                "discount": discount,
                "product": {
                    "description": item.product_name,
                    "product_key": classification.product_key,
                    "unit_key": classification.unit_key,
                    "price": price,
                    "tax_included": False,
                    "taxability": "01" if classification.tax_kind == "not_subject" else "02",
                    "taxes": taxes,
                },
            }
        )
    subtotal = money(sum((line.gross_amount for line in lines), Decimal(0)))
    discount = money(sum((line.discount_amount for line in lines), Decimal(0)))
    tax = money(sum((line.tax_amount for line in lines), Decimal(0)))
    total = money(subtotal - discount + tax)
    if total != order.total_amount or request.total_amount != order.total_amount:
        raise bad_request(
            "La clasificación fiscal no concilia con el importe histórico de la venta"
        )
    recipient = (
        body.recipient.model_dump(mode="json") if body.recipient else request.recipient_snapshot
    )
    payload = {
        "type": "I",
        "payment_method": "PUE",
        "payment_form": body.payment_form,
        "use": recipient["cfdi_use"],
        "currency": "MXN",
        "customer": {
            "legal_name": recipient["legal_name"],
            "tax_id": recipient["rfc"],
            "tax_system": recipient["tax_regime"],
            "email": recipient["email"],
            "address": {"zip": recipient["postal_code"]},
        },
        "items": provider_items,
    }
    return PreviewResponse(
        recipient_snapshot=recipient,
        request_id=request.id,
        order_id=order.id,
        environment=body.environment,
        subtotal_amount=subtotal,
        discount_amount=discount,
        tax_amount=tax,
        total_amount=total,
        lines=lines,
    ), payload
