"""Pure, chronological finished-bag scenario. No database or network access."""

import argparse
import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Mexico_City")
CATALOG = {
    "100": {"price": 95, "cost": 52, "threshold": 4},
    "250": {"price": 195, "cost": 110, "threshold": 8},
    "500": {"price": 365, "cost": 215, "threshold": 3},
}
BRANCHES = {"central": "Almacén central", "centro": "Barra Centro", "norte": "Barra Norte"}


def build_plan(anchor: date) -> dict:
    lots = {
        "100-A": ("100", -34, 45, 60),
        "250-A": ("250", -34, 45, 100),
        "500-A": ("500", -34, 45, 24),
        "250-B": ("250", -19, 21, 60),
        "250-C": ("250", -4, 21, 70),
    }
    events = []
    stock = defaultdict(int)
    reserved = defaultdict(int)
    tick = 0

    def at(offset, hour, minute=0):
        return datetime.combine(anchor + timedelta(days=offset), time(hour, minute), TZ).isoformat()

    def add(kind, offset, hour, **fields):
        nonlocal tick
        tick += 1
        event = {"key": f"cc-v1-{tick:04}", "kind": kind, "at": at(offset, hour), **fields}
        events.append(event)
        return event

    def move(lot, source, target, quantity, offset):
        assert quantity > 0 and stock[source, lot] - reserved[source, lot] >= quantity
        add("transfer", offset, 8, lot=lot, source=source, branch=target, quantity=quantity)
        stock[source, lot] -= quantity
        stock[target, lot] += quantity

    def supply(branch, lot, quantity, offset):
        shortage = quantity - stock[branch, lot]
        if shortage > 0:
            batch = min(max(shortage, 6), stock["central", lot])
            assert batch >= shortage, (offset, branch, lot, stock)
            move(lot, "central", branch, batch, offset)

    for offset in range(-34, 1):
        index = offset + 34
        for lot, (_sku, received, _days, quantity) in lots.items():
            if received == offset:
                add("receive", offset, 7, lot=lot, quantity=quantity, branch="central")
                stock["central", lot] += quantity
        baskets = {"centro": defaultdict(dict), "norte": defaultdict(dict)}

        def put(branch, lot, quantity, baskets=baskets):
            if quantity:
                sku = lots[lot][0]
                baskets[branch][sku][lot] = quantity

        put("centro", "100-A", 1 + int(offset in (-12, -8, -3, -1)))
        put("norte", "100-A", int(index % 2 == 0))
        if offset <= -5:
            put("centro", "250-A", 1 + int(index % 3 != 0))
            put("norte", "250-A", 1 + int(index % 5 == 0))
        for day, branch in ((-4, "centro"), (-3, "norte"), (-2, "centro"), (-1, "norte")):
            if offset == day:
                put(branch, "250-A", 2)
        if offset >= -18:
            put("centro", "250-B", 1 + int(index % 4 == 0) + int(-10 <= offset <= -5))
            put("norte", "250-B", int(index % 2 == 0))
        if offset >= -4:
            put("centro", "250-C", 1 + int(index % 2 == 1))
            put("norte", "250-C", 1)
        put("centro", "500-A", int(index % 7 == 0))
        put("norte", "500-A", int(offset == -11))
        for branch, basket in baskets.items():
            for parts in basket.values():
                for lot, quantity in parts.items():
                    supply(branch, lot, quantity, offset)
            if offset == 0:
                supply(branch, "250-C", 4, offset)
            add("open", offset, 9, branch=branch, opening_cash=500)
            items = [{"sku": sku, "parts": parts} for sku, parts in basket.items()]
            add(
                "sale",
                offset,
                12,
                branch=branch,
                items=items,
                method=("cash", "manual_card", "bank_transfer")[index % 3],
                discount=20 if offset == -4 and branch == "centro" else 0,
            )
            for item in items:
                for lot, quantity in item["parts"].items():
                    assert offset >= lots[lot][1]
                    stock[branch, lot] -= quantity
                    assert stock[branch, lot] >= 0
            if offset == 0 and branch == "centro":
                # Three delivered bags: refund (no stock return), void without
                # delivery (returns original lot), void with delivery (no return).
                for action in ("refund", "void_no_delivery", "void_delivered"):
                    add("exception", offset, 13, branch=branch, action=action, lot="250-C")
                    if action != "void_no_delivery":
                        stock[branch, "250-C"] -= 1
            add("close", offset, 16, branch=branch)
    # Keep both old and attention batches visibly distributed across locations.
    for lot, target in (("250-A", 2), ("250-B", 5), ("250-C", 8)):
        for branch in ("centro", "norte"):
            if stock[branch, lot] < target:
                move(lot, "central", branch, target - stock[branch, lot], 0)
    add("waste", 0, 16, branch="central", lot="250-B", quantity=2)
    stock["central", "250-B"] -= 2
    add("reserve", 0, 16, branch="centro", sku="250", quantity=3, lot="250-B")
    reserved["centro", "250-B"] = 3
    assert all(q >= reserved[k] for k, q in stock.items())
    dates = {
        lot: {
            "sku": sku,
            "manufactured_on": (anchor + timedelta(days=offset)).isoformat(),
            "rotation_days": days,
            "rotation_on": (anchor + timedelta(days=offset + days)).isoformat(),
            "expires_on": None,
            "rotation_label": "fecha_objetivo",
            "received": quantity,
        }
        for lot, (sku, offset, days, quantity) in lots.items()
    }
    balances = [
        {
            "branch": branch,
            "lot": lot,
            "sku": lots[lot][0],
            "physical": qty,
            "reserved": reserved[branch, lot],
            "available": qty - reserved[branch, lot],
        }
        for (branch, lot), qty in sorted(stock.items())
    ]
    return {
        "version": 1,
        "anchor": anchor.isoformat(),
        "timezone": str(TZ),
        "catalog": CATALOG,
        "branches": BRANCHES,
        "lots": dates,
        "events": sorted(events, key=lambda e: e["at"]),
        "expected": balances,
        "browser_scenario": {
            "transfer": {"lot": "250-B", "quantity": 2, "source": "central", "branch": "centro"},
            "sale": {"lot": "250-C", "quantity": 1, "branch": "centro"},
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--anchor", type=date.fromisoformat)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    plan = build_plan(args.anchor or datetime.now(TZ).date())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Plan: {len(plan['events'])} operations, {len(plan['lots'])} lots; no writes performed")
