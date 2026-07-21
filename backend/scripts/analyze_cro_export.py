"""Analyze the PII-free CRO export without joining customer or tenant data."""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

VARIANTS = ("control", "treatment")
Z_95 = 1.959963984540054


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _rate(count: int, sample: int) -> float:
    return count / sample if sample else 0.0


def wilson_interval(count: int, sample: int) -> tuple[float, float]:
    if sample == 0:
        return 0.0, 0.0
    proportion = count / sample
    denominator = 1 + Z_95**2 / sample
    center = (proportion + Z_95**2 / (2 * sample)) / denominator
    margin = (
        Z_95
        * math.sqrt(
            proportion * (1 - proportion) / sample + Z_95**2 / (4 * sample**2)
        )
        / denominator
    )
    return max(0.0, center - margin), min(1.0, center + margin)


def newcombe_difference_interval(
    control_count: int,
    control_sample: int,
    treatment_count: int,
    treatment_sample: int,
) -> tuple[float, float]:
    """Newcombe-Wilson interval for treatment minus control risk."""
    if not control_sample or not treatment_sample:
        return 0.0, 0.0
    control_rate = _rate(control_count, control_sample)
    treatment_rate = _rate(treatment_count, treatment_sample)
    control_low, control_high = wilson_interval(control_count, control_sample)
    treatment_low, treatment_high = wilson_interval(treatment_count, treatment_sample)
    difference = treatment_rate - control_rate
    lower = difference - math.sqrt(
        (treatment_rate - treatment_low) ** 2 + (control_high - control_rate) ** 2
    )
    upper = difference + math.sqrt(
        (treatment_high - treatment_rate) ** 2 + (control_rate - control_low) ** 2
    )
    return lower, upper


def _metric(clients: set[str], exposed: set[str]) -> dict[str, Any]:
    count = len(clients & exposed)
    sample = len(exposed)
    low, high = wilson_interval(count, sample)
    return {"count": count, "sample": sample, "rate": _rate(count, sample), "ci95": [low, high]}


def analyze_experiment(
    rows: Iterable[dict[str, str]],
    *,
    experiment_id: str,
    days: int,
    as_of: datetime | None = None,
    minimum_per_variant: int = 2759,
) -> dict[str, Any]:
    parsed = [({**row}, _timestamp(row["date"])) for row in rows if row.get("date")]
    if not parsed:
        raise ValueError("The CRO export has no dated rows")
    end = as_of or max(timestamp for _, timestamp in parsed)
    end = end if end.tzinfo else end.replace(tzinfo=UTC)
    start = end - timedelta(days=days)
    window = sorted(
        ((row, timestamp) for row, timestamp in parsed if start <= timestamp <= end),
        key=lambda item: item[1],
    )

    exposures: dict[str, tuple[str, datetime, dict[str, str]]] = {}
    conflicts: set[str] = set()
    for row, timestamp in window:
        if row.get("event") != "experiment_exposed" or row.get("experiment_id") != experiment_id:
            continue
        variant = row.get("variant", "")
        client_id = row.get("client_id", "")
        if variant not in VARIANTS or not client_id:
            continue
        previous = exposures.get(client_id)
        if previous and previous[0] != variant:
            conflicts.add(client_id)
            continue
        exposures.setdefault(client_id, (variant, timestamp, row))
    for client_id in conflicts:
        exposures.pop(client_id, None)

    outcomes: dict[str, dict[str, set[str]]] = {
        variant: {
            "primary": set(),
            "signup": set(),
            "secondary_cta": set(),
            "validation_failure": set(),
        }
        for variant in VARIANTS
    }
    for row, timestamp in window:
        client_id = row.get("client_id", "")
        exposure = exposures.get(client_id)
        if not exposure or timestamp < exposure[1]:
            continue
        variant = exposure[0]
        event = row.get("event")
        cta = row.get("cta")
        if event == "landing_cta_clicked" and cta == "hero":
            outcomes[variant]["primary"].add(client_id)
        elif event == "signup_completed":
            outcomes[variant]["signup"].add(client_id)
        elif event == "landing_cta_clicked" and cta == "hero_secondary":
            outcomes[variant]["secondary_cta"].add(client_id)
        elif event == "signup_validation_failed":
            outcomes[variant]["validation_failure"].add(client_id)

    exposed = {
        variant: {client_id for client_id, value in exposures.items() if value[0] == variant}
        for variant in VARIANTS
    }
    metrics = {
        variant: {
            name: _metric(clients, exposed[variant])
            for name, clients in outcomes[variant].items()
        }
        for variant in VARIANTS
    }
    control_primary = metrics["control"]["primary"]
    treatment_primary = metrics["treatment"]["primary"]
    difference = treatment_primary["rate"] - control_primary["rate"]
    difference_ci = newcombe_difference_interval(
        control_primary["count"],
        control_primary["sample"],
        treatment_primary["count"],
        treatment_primary["sample"],
    )
    relative_uplift = (
        treatment_primary["rate"] / control_primary["rate"] - 1
        if control_primary["rate"]
        else None
    )
    enough_sample = all(len(exposed[variant]) >= minimum_per_variant for variant in VARIANTS)
    control_secondary = metrics["control"]["secondary_cta"]["rate"]
    treatment_secondary = metrics["treatment"]["secondary_cta"]["rate"]
    control_failures = metrics["control"]["validation_failure"]["rate"]
    treatment_failures = metrics["treatment"]["validation_failure"]["rate"]
    guardrail_deterioration = bool(
        (control_secondary and treatment_secondary < control_secondary * 0.90)
        or (control_failures and treatment_failures > control_failures * 1.10)
    )

    if not enough_sample:
        decision = "inconclusive_insufficient_sample"
    elif difference_ci[0] > 0 and not guardrail_deterioration:
        decision = "winner"
    elif difference_ci[1] < 0 or guardrail_deterioration:
        decision = "loser"
    else:
        decision = "inconclusive"

    segments: dict[str, list[dict[str, Any]]] = {}
    for dimension in ("device_class", "viewport_bucket", "channel"):
        grouped: defaultdict[tuple[str, str], set[str]] = defaultdict(set)
        for client_id, (variant, _, row) in exposures.items():
            value = (
                f"{row.get('source') or 'unknown'}/{row.get('medium') or 'unknown'}"
                if dimension == "channel"
                else row.get(dimension) or "unknown"
            )
            grouped[(value, variant)].add(client_id)
        segments[dimension] = []
        for (value, variant), clients in sorted(grouped.items()):
            segments[dimension].append(
                {
                    "value": value,
                    "variant": variant,
                    "sample": len(clients),
                    "primary": _metric(outcomes[variant]["primary"], clients),
                    "signup": _metric(outcomes[variant]["signup"], clients),
                }
            )

    return {
        "experiment_id": experiment_id,
        "window": {"days": days, "start": start.isoformat(), "end": end.isoformat()},
        "minimum_per_variant": minimum_per_variant,
        "conflicting_assignments_excluded": len(conflicts),
        "metrics": metrics,
        "effect": {
            "primary_absolute_difference": difference,
            "primary_difference_ci95": list(difference_ci),
            "primary_relative_uplift": relative_uplift,
        },
        "decision": decision,
        "segments": segments,
    }


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.2f}%"


def render_markdown(result: dict[str, Any]) -> str:
    lines = [
        f"# CRO checkpoint — {result['experiment_id']}",
        "",
        f"Window: {result['window']['start']} → {result['window']['end']} "
        f"({result['window']['days']} days)",
        f"Decision: **{result['decision']}**",
        f"Minimum preregistered sample: {result['minimum_per_variant']} per variant.",
        "",
        "| Variant | Exposed | Hero CTA | 95% CI | Signup | Secondary CTA | Validation failure |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for variant in VARIANTS:
        metrics = result["metrics"][variant]
        primary = metrics["primary"]
        lines.append(
            f"| {variant} | {primary['sample']} | {_percent(primary['rate'])} "
            f"({primary['count']}) | {_percent(primary['ci95'][0])}–{_percent(primary['ci95'][1])} "
            f"| {_percent(metrics['signup']['rate'])} | "
            f"{_percent(metrics['secondary_cta']['rate'])} | "
            f"{_percent(metrics['validation_failure']['rate'])} |"
        )
    effect = result["effect"]
    lines.extend(
        [
            "",
            f"Primary relative uplift: {_percent(effect['primary_relative_uplift'])}.",
            "Primary absolute difference (treatment − control): "
            f"{_percent(effect['primary_absolute_difference'])} "
            f"(95% CI {_percent(effect['primary_difference_ci95'][0])} to "
            f"{_percent(effect['primary_difference_ci95'][1])}).",
            "",
        ]
    )
    for dimension in ("device_class", "viewport_bucket", "channel"):
        lines.extend(
            [
                f"## {dimension}",
                "",
                "| Segment | Variant | Exposed | Hero CTA | Signup |",
                "|---|---|---:|---:|---:|",
            ]
        )
        for item in result["segments"][dimension]:
            lines.append(
                f"| {item['value']} | {item['variant']} | {item['sample']} | "
                f"{_percent(item['primary']['rate'])} | {_percent(item['signup']['rate'])} |"
            )
        lines.append("")
    if result["conflicting_assignments_excluded"]:
        lines.append(
            f"Excluded conflicting assignments: {result['conflicting_assignments_excluded']}."
        )
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--experiment", default="exp_01_cta_specificity")
    parser.add_argument("--days", type=int, choices=(7, 30), required=True)
    parser.add_argument("--as-of", type=_timestamp)
    parser.add_argument("--minimum-per-variant", type=int, default=2759)
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    args = parser.parse_args()
    with args.csv_path.open(encoding="utf-8", newline="") as source:
        result = analyze_experiment(
            csv.DictReader(source),
            experiment_id=args.experiment,
            days=args.days,
            as_of=args.as_of,
            minimum_per_variant=args.minimum_per_variant,
        )
    output = json.dumps(result, indent=2) if args.format == "json" else render_markdown(result)
    print(output, end="")


if __name__ == "__main__":
    main()
