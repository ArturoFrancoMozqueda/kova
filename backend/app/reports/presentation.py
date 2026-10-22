"""Spanish display copy at the report API boundary, outside the inference engine."""


def business_story_copy(report: dict) -> dict:
    """Keep approved engine output intact; only correct its known display phrases."""
    count = report["summary"]["completed_orders"]
    summary = report["executive_summary"].replace(
        f"en ventas netas a partir de {count} ordenes.",
        f"en ventas netas a partir de {count} órdenes.",
        1,
    )
    dominant = report["dominant_payment"]
    actions = []
    for original in report["recommended_actions"]:
        action = dict(original)
        if (
            dominant
            and dominant["method"] == "cash"
            and action["title"] == "Reduce dependencia de efectivo"
            and action["detail"].startswith("Cash representa ")
        ):
            action["detail"] = "Efectivo" + action["detail"][len("Cash"):]
        actions.append(action)
    return {**report, "executive_summary": summary, "recommended_actions": actions}
