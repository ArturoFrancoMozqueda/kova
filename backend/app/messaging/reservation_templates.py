"""Fixed Utility templates: no marketing, links, free text or private service notes."""

import re

LANGUAGE = "es_MX"
DEFINITIONS = {
    "kova_reserva_confirmacion_v1": (
        "Hola {{1}}. Tu reserva en {{2}} está confirmada para el {{3}} a las {{4}}."
    ),
    "kova_reserva_recordatorio_v1": (
        "Hola {{1}}. Te recordamos tu reserva en {{2}} para el {{3}} a las {{4}}."
    ),
}
DEFINITIONS.update(
    {
        name.replace("reserva", "mesa"): body + " Te esperamos con tu grupo de {{5}} personas."
        for name, body in list(DEFINITIONS.items())
    }
)


def render(name, parameters):
    return re.sub(
        r"\{\{([1-5])\}\}", lambda match: parameters[int(match[1]) - 1], DEFINITIONS[name]
    )
