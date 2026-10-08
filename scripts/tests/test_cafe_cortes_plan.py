"""Independent accounting and temporal invariants of the presentation scenario."""

import importlib.util
import unittest
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

_path = Path(__file__).resolve().parents[2] / "backend/scripts/cafe_cortes_plan.py"
_spec = importlib.util.spec_from_file_location("coffee_plan", _path)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)


class CoffeeScenarioTest(unittest.TestCase):
    def test_every_chronological_prefix_is_available_after_receipt_and_roasting(self):
        for anchor in (date(2026, 10, 8), date(2028, 3, 1)):
            plan = _module.build_plan(anchor)
            ledger = defaultdict(int)
            keys = set()
            for event in plan["events"]:
                self.assertNotIn(event["key"], keys)
                keys.add(event["key"])
                when = datetime.fromisoformat(event["at"])
                self.assertEqual(when.utcoffset(), -timedelta(hours=6))
                branch = event["branch"]
                kind = event["kind"]
                if kind == "receive":
                    ledger[branch, event["lot"]] += event["quantity"]
                elif kind == "transfer":
                    self.assertLessEqual(event["quantity"], 8)
                    ledger[event["source"], event["lot"]] -= event["quantity"]
                    ledger[branch, event["lot"]] += event["quantity"]
                elif kind == "sale":
                    for item in event["items"]:
                        for lot, quantity in item["parts"].items():
                            self.assertGreaterEqual(when.date(), date.fromisoformat(
                                plan["lots"][lot]["manufactured_on"]))
                            self.assertIsInstance(quantity, int)
                            ledger[branch, lot] -= quantity
                elif kind == "waste":
                    ledger[branch, event["lot"]] -= event["quantity"]
                elif kind == "exception" and event["action"] != "void_no_delivery":
                    ledger[branch, event["lot"]] -= 1
                elif kind == "reserve":
                    self.assertGreaterEqual(ledger[branch, event["lot"]], event["quantity"])
                self.assertTrue(all(quantity >= 0 for quantity in ledger.values()), event)
            for expected in plan["expected"]:
                self.assertEqual(ledger[expected["branch"], expected["lot"]], expected["physical"])
            self.assertEqual(sum(ledger[b, "100-A"] for b in plan["branches"]), 3)
            self.assertEqual(sum(ledger[b, "500-A"] for b in plan["branches"]), 18)

    def test_shift_pairs_and_dates_match_35_days(self):
        plan = _module.build_plan(date(2026, 10, 8))
        opened = {}
        days = set()
        for event in plan["events"]:
            branch, when = event["branch"], datetime.fromisoformat(event["at"])
            if event["kind"] == "open":
                self.assertNotIn(branch, opened)
                opened[branch] = when
                days.add(when.date())
            if event["kind"] in ("sale", "exception"):
                self.assertGreater(when, opened[branch])
            if event["kind"] == "close":
                self.assertGreater(when, opened.pop(branch))
        self.assertFalse(opened)
        self.assertEqual(len(days), 35)
        attention = date.fromisoformat(plan["lots"]["250-B"]["rotation_on"])
        self.assertEqual(attention, date(2026, 10, 10))
        self.assertTrue(all(lot["expires_on"] is None for lot in plan["lots"].values()))


if __name__ == "__main__":
    unittest.main()
