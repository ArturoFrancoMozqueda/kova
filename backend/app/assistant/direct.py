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
    "como registrar una venta offline": (5, "Registra la venta en Caja y verifica los "
        "pendientes en el dispositivo original. Las ventas offline aparecen en Análisis "
        "después de sincronizar; no registres otra vez una venta para hacerla aparecer."),
    "mi venta offline no aparece en analisis": (3, "Las ventas offline aparecen en Análisis "
        "después de sincronizar. Revisa la conexión y los pendientes en el dispositivo "
        "original; no vuelvas a capturar la misma venta."),
    "como revisar mi inventario": (7, "En Inventario revisa las existencias de la sucursal "
        "activa. Análisis muestra alertas de reposición cuando hay datos suficientes. "
        "Verifica las existencias físicas antes de registrar un ajuste."),
    "como configurar el stock bajo": (7, "Configura el umbral de stock bajo en Catálogo "
        "para los productos con control de inventario. Revisa las existencias de la "
        "sucursal activa en Inventario."),
    "donde veo mis ventas": (3, "Consulta las ventas registradas en Ventas y sus métricas "
        "en Análisis. Revisa la sucursal y el periodo; las ventas offline se incluyen "
        "después de sincronizar."),
    "como cambio de sucursal": (4, "Selecciona la sucursal antes de operar. Ventas, caja "
        "e inventario se consultan por sucursal; catálogo, precios y permisos pertenecen "
        "al negocio. La comparación requiere autorización para reportes."),
    "puedo calcular utilidad sin costos": (8, "Las ventas no equivalen a utilidad. Sin "
        "costos o gastos suficientes no hay una cifra confiable de ganancia. Revisa "
        "la disponibilidad del reporte y los datos registrados; capturarlos no garantiza "
        "que ese cálculo esté disponible."),
}
ALIASES = {
    "como vender sin internet": "como registrar una venta offline",
    "como registrar una venta sin conexion": "como registrar una venta offline",
    "por que no aparece mi venta offline": "mi venta offline no aparece en analisis",
    "como consultar existencias": "como revisar mi inventario",
    "donde veo mi inventario": "como revisar mi inventario",
    "donde configuro el stock bajo": "como configurar el stock bajo",
    "donde consulto mis ventas": "donde veo mis ventas",
    "cuanto gane si no tengo costos ni gastos registrados": "puedo calcular utilidad sin costos",
    "puedo calcular utilidad sin costos ni gastos": "puedo calcular utilidad sin costos",
}
QUERIES = {
    "cuanto vendi": "get_sales", "cuanto he vendido": "get_sales",
    "como van mis ventas": "get_sales", "muestra mis ventas": "get_sales",
    "revisa mis ventas": "get_sales",
    "cuanto vendimos": "get_sales", "muestrame mis ventas": "get_sales",
    "muestrame las ventas": "get_sales", "cuales fueron mis ventas": "get_sales",
    "que producto se vende mas": "get_top_products",
    "que producto es el que mas se vende": "get_top_products",
    "que productos se venden mas": "get_top_products",
    "cual ha sido mi producto mejor vendido": "get_top_products",
    "cual es mi producto mas vendido": "get_top_products",
    "cuales son mis productos mas vendidos": "get_top_products",
    "que productos debo reponer": "get_inventory",
    "que productos tienen stock bajo": "get_inventory",
    "cuales productos debo reponer": "get_inventory",
    "que sucursal vende mas": "compare_branches",
    "cual sucursal vende mas": "compare_branches",
}
PERIODS = {"": "hoy", "hoy": "hoy", "ayer": "ayer",
           "esta semana": "esta semana", "este mes": "este mes",
           "de esta semana": "esta semana", "de este mes": "este mes",
           "de hoy": "hoy", "de ayer": "ayer",
           "la semana pasada": "semana pasada", "de la semana pasada": "semana pasada",
           "el mes pasado": "mes pasado", "del mes pasado": "mes pasado"}
HISTORY_PERIODS = ("en todo mi historico", "en todo mi historial", "en todo el historico",
                   "en todo el historial", "de todo mi historial", "historicamente")


def normalize(content):
    normalized = unicodedata.normalize("NFKD", content.casefold())
    normalized = "".join(c for c in normalized if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", normalized).strip().strip("¿?¡!.").strip()


def match(content):
    query = normalize(content)
    # Remove only bounded polite wrappers around a complete known question.
    # Never search inside instructions, negations, extra questions or followups.
    query = re.sub(r"^(?:por favor[, ]+|me puedes decir |puedes decirme )", "", query,
                   count=1)
    query = query.removeprefix("¿")
    query = re.sub(r"[, ]+por favor$", "", query, count=1)
    query = ALIASES.get(query, query)
    if query in FAQ:
        return "faq", query, None
    for suffix in HISTORY_PERIODS:
        for base, tool in QUERIES.items():
            if tool == "get_top_products" and query == base + " " + suffix:
                return tool, "historico", None
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
        elif key == "semana pasada":
            end = today - timedelta(days=today.weekday() + 1)
            start = end - timedelta(days=6)
        elif key == "mes pasado":
            end = today.replace(day=1) - timedelta(days=1)
            start = end.replace(day=1)
        arguments = {"all_history": True} if key == "historico" else {
            "start_date": start.isoformat(), "end_date": end.isoformat(),
        }
        result = tools.call(db, tenant, user, name, arguments)
        guide = 4 if name == "compare_branches" else 3
        period = {"hoy": "hoy", "ayer": "ayer", "esta semana": "esta semana",
                  "este mes": "lo que va del mes", "historico": "todo el histórico",
                  "semana pasada": "la semana pasada", "mes pasado": "el mes pasado"}[key]
        if name == "get_sales":
            metrics = result
            content = f"Estas son tus ventas de {period} en la sucursal activa. "
            content += "Las tarjetas muestran las cifras registradas; vender no equivale a "
            content += "obtener utilidad. Revisa productos e inventario antes de decidir."
        elif name == "get_top_products":
            from app.assistant.grounding import product_conclusion

            content = product_conclusion(result)
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
