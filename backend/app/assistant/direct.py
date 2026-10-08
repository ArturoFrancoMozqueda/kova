"""Exact, standalone read questions only. Never infer writes or parse instructions."""

import json
import re
import unicodedata
from datetime import date, timedelta

from app.assistant import knowledge, tools

GUIDE_PREFIX = "6141fe70-9b98-4d18-865e-a874a72e177"
FAQ = {
    "como importar mi catalogo": (2, "Abre Catálogo y usa la plantilla de importación. "
        "Carga tu archivo, corrige los errores de la vista previa y confirma antes de importar."),
    "como importar productos": (2, "Abre Catálogo y usa la plantilla de importación. "
        "Revisa nombres, precios y categorías en la vista previa antes de confirmar."),
    "donde configuro el ticket": (1, "Abre Configuración del negocio y revisa los ajustes "
        "del ticket. Guarda el nombre comercial, el pie y el ancho de papel; verifica "
        "el resultado antes de imprimir."),
    "como registrar una venta": (5, "Abre Caja, selecciona los productos y revisa cantidades "
        "y total antes de registrar el pago. Para cobrar efectivo necesitas un turno abierto. "
        "Después verifica la venta completada en Ventas."),
    "como abrir un turno": (6, "Abre Turnos y registra el fondo inicial antes de cobrar "
        "efectivo. El asistente te orienta; la apertura se confirma en esa pantalla."),
    "como cerrar un turno": (6, "En Turnos revisa ventas y movimientos, cuenta el efectivo "
        "físico y registra el cierre. Revisa cualquier diferencia con el efectivo esperado "
        "sin asumir pérdidas o fraude."),
    "que es la venta neta": (8, "La venta neta descuenta los reembolsos de las ventas "
        "completadas del periodo. No equivale a utilidad: para estimarla también necesitas "
        "costos y gastos registrados."),
    "que es el ticket promedio": (8, "El ticket promedio relaciona la venta neta con los "
        "tickets completados. Revísalo junto con el número de ventas y los productos "
        "vendidos antes de decidir una acción."),
}
QUERIES = {
    "cuanto vendi": "get_sales", "cuanto he vendido": "get_sales",
    "como van mis ventas": "get_sales", "muestra mis ventas": "get_sales",
    "revisa mis ventas": "get_sales",
    "que producto se vende mas": "get_top_products",
    "que producto es el que mas se vende": "get_top_products",
    "que productos se venden mas": "get_top_products",
    "cuales son mis productos mas vendidos": "get_top_products",
    "que productos debo reponer": "get_inventory",
    "que productos tienen stock bajo": "get_inventory",
    "que sucursal vende mas": "compare_branches",
}
PERIODS = {"": "hoy", "hoy": "hoy", "ayer": "ayer",
           "esta semana": "esta semana", "este mes": "este mes",
           "de esta semana": "esta semana", "de este mes": "este mes"}


def normalize(content):
    normalized = unicodedata.normalize("NFKD", content.casefold())
    normalized = "".join(c for c in normalized if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", normalized).strip().strip("¿?¡!.").strip()


def match(content):
    query = normalize(content)
    if query in FAQ:
        return "faq", query, None
    for suffix, period in PERIODS.items():
        for base, tool in QUERIES.items():
            if query == base + (" " + suffix if suffix else ""):
                return tool, period, None
    return None


def answer(db, tenant, user, matched):
    name, key, _ = matched
    metrics, cards = None, []
    if name == "faq":
        guide, content = FAQ[key]
    else:
        today = date.fromisoformat(tools.configuration(db, tenant)["today"])
        start = end = today
        if key == "ayer":
            start = end = today - timedelta(days=1)
        elif key == "esta semana":
            start = today - timedelta(days=today.weekday())
        elif key == "este mes":
            start = today.replace(day=1)
        result = tools.call(db, tenant, user, name, {
            "start_date": start.isoformat(), "end_date": end.isoformat(),
        })
        guide = 4 if name == "compare_branches" else 3
        period = {"hoy": "hoy", "ayer": "ayer", "esta semana": "esta semana",
                  "este mes": "lo que va del mes"}[key]
        if name == "get_sales":
            metrics = result
            content = f"Estas son tus ventas de {period} en la sucursal activa. "
            content += "Las tarjetas muestran las cifras registradas; vender no equivale a "
            content += "obtener utilidad. Revisa productos e inventario antes de decidir."
        elif name == "get_top_products":
            content = (f"Estos son los productos más vendidos de {period} en la sucursal "
                       "activa, ordenados por unidades. Revisa sus existencias antes de "
                       "preparar una reposición; esta comparación no indica rentabilidad.")
            if not result.get("products"):
                content = f"No hay productos vendidos registrados para {period} en esta "
                content += "sucursal. Revisa el periodo y que las ventas estén completadas "
                content += "y sincronizadas."
        elif name == "get_inventory":
            content = (f"Estas señales de reposición usan el inventario registrado y las "
                       f"ventas de {period}. Verifica las existencias físicas antes de "
                       "comprar; si falta historial, no hay una duración confiable.")
            if not result.get("restock_alerts"):
                content = "No hay alertas de reposición en la muestra disponible. Esto no "
                content += "confirma que todo el inventario esté completo; revisa existencias "
                content += "y umbrales de los productos con control de inventario."
        else:
            content = (f"Esta comparación muestra las ventas netas de {period} por sucursal. "
                       "Compara también tickets y disponibilidad; los resultados no "
                       "demuestran por sí solos una causa ni mayor utilidad.")
        if name != "get_sales":
            cards.append({"kind": name, "data": result})
    identifier = GUIDE_PREFIX + str(guide)
    title, _, path = knowledge.GUIDES[identifier]
    evidence = [{"id": identifier, "title": title, "page": 1, "path": path, "public": True}]
    return (content, evidence, json.loads(json.dumps(metrics, default=str)),
            json.loads(json.dumps(cards, default=str)))
