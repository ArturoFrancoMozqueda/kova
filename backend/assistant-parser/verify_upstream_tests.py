"""Fail the image build if upstream security regressions failed or were skipped."""

import json
import platform
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HIGH_SEVERITY_SUITES = {
    "intproto_test", "intproto_addclass_test", "lstm_nullchar_test", "normproto_test",
    "fullyconnected_test", "lstm_layer_test", "unicharset_load_test", "genericvector_test",
}
EXPECTED_SUITES = HIGH_SEVERITY_SUITES | {
    "weightmatrix_deserialize_test", "weightmatrix_scales_test", "weightmatrix_intdim_test",
    "lstm_recoder_test", "recoder_test", "matrix_deserializesize_test", "adaptive_test",
    "adaptive_templates_test", "plumbing_test",
}


def verify(directory: Path) -> dict:
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    skipped_cases = []
    for name in sorted(EXPECTED_SUITES):
        root = ET.parse(directory / f"{name}.xml").getroot()
        counts = {key: int(root.get(key, "0")) for key in totals}
        # GoogleTest may omit the aggregate skipped attribute on <testsuites>.
        # Count actual skipped cases so architecture skips remain visible.
        counts["skipped"] = sum(case.find("skipped") is not None
                                for case in root.iter("testcase"))
        if counts["tests"] == 0 or counts["failures"] or counts["errors"]:
            raise ValueError(f"Upstream security regression did not pass: {name}")
        if name in HIGH_SEVERITY_SUITES and counts["skipped"]:
            raise ValueError(f"High-severity security regression was skipped: {name}")
        for key, value in counts.items():
            totals[key] += value
        for case in root.iter("testcase"):
            skipped = case.find("skipped")
            if skipped is not None:
                # This upstream test targets an integer SIMD backend unavailable
                # on some architectures. Record the skip; never count it as pass.
                reason = skipped.get("message", "")
                if (name != "weightmatrix_intdim_test"
                        or "no SIMD int backend active" not in reason):
                    raise ValueError(f"Unexpected skipped security regression: {name}")
                skipped_cases.append({"suite": name, "case": case.get("name"), "reason": reason})
    return {"architecture": platform.machine(), "suites": len(EXPECTED_SUITES),
            **totals, "skipped_cases": skipped_cases}


if __name__ == "__main__":
    directory = Path(sys.argv[1])
    summary = verify(directory)
    (directory / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    sys.stdout.write(json.dumps(summary) + "\n")
    sys.stdout.flush()
