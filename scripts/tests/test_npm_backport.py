"""Gate-only regressions: no network, dependency execution or attack patterns."""

import importlib.util
import base64
import json
import tempfile
import unittest
from unittest import mock
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SPEC = importlib.util.spec_from_file_location(
    "npm_backport_review_tests", Path(__file__).resolve().parents[1] / "npm_backport.py"
)
BACKPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKPORT)
AUDIT_SPEC = importlib.util.spec_from_file_location(
    "audit_dependencies_backport_review_tests",
    Path(__file__).resolve().parents[1] / "audit_dependencies.py",
)
AUDIT = importlib.util.module_from_spec(AUDIT_SPEC)
AUDIT_SPEC.loader.exec_module(AUDIT)

NOW = datetime(2026, 11, 20, tzinfo=UTC)


def review():
    return {
        "advisory": BACKPORT.GHSA,
        "review": {
            "status": "verified", "owner": "security-review-owner",
            "reviewedAt": "2026-11-17T00:00:00Z", "expiresAt": "2026-11-24T00:00:00Z",
            "evidence": "reviewed-build-evidence",
        },
        "releases": {version: {} for version in ("2.3.2", "4.0.4", "4.0.7")},
    }


def advisory(identifier=BACKPORT.GHSA):
    return {
        "ghsa_id": identifier, "cve_id": BACKPORT.CVE,
        "html_url": f"https://github.com/advisories/{identifier}", "severity": "high",
        "type": "reviewed", "updated_at": "2026-11-17T15:56:44Z", "withdrawn_at": None,
        "vulnerabilities": [{
            "package": {"ecosystem": "npm", "name": "picomatch"},
            "first_patched_version": None, "vulnerable_functions": [],
            "vulnerable_version_range": "<= 4.0.7",
        }],
    }


def findings():
    nodes = ["node_modules/picomatch", "node_modules/consumer/node_modules/picomatch"]
    lock = {"packages": {name: {} for name in [*nodes, "node_modules/consumer"]}}
    leaf = {
        "source": 1247710, "name": "picomatch", "dependency": "picomatch",
        "url": f"https://github.com/advisories/{BACKPORT.GHSA}",
        "severity": "high", "range": "<=4.0.7",
    }
    data = {
        "metadata": {"vulnerabilities": {"high": 2, "critical": 0}},
        "vulnerabilities": {
            "picomatch": {"severity": "high", "nodes": nodes, "via": [leaf]},
            "consumer": {"severity": "high", "nodes": ["node_modules/consumer"], "via": ["picomatch"]},
        },
    }
    return data, lock, [(name, "4.0.4") for name in nodes]


class BackportReviewValidityTests(unittest.TestCase):
    def load(self, data, now=NOW):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "manifest.json").write_text(json.dumps(data))
            return BACKPORT.load_review(root, now)

    def test_exact_seven_day_review_is_valid_before_expiry(self):
        data, digest = self.load(review())
        self.assertEqual(data["review"]["owner"], "security-review-owner")
        self.assertRegex(digest, r"^[0-9a-f]{64}$")

    def test_expiry_is_inclusive(self):
        with self.assertRaises(BACKPORT.BackportError):
            self.load(review(), datetime(2026, 11, 24, tzinfo=UTC))

    def test_dates_require_timezone_order_and_at_most_seven_days(self):
        invalid = [
            {"reviewedAt": None}, {"reviewedAt": "invalid"},
            {"reviewedAt": "2026-11-17T00:00:00"},
            {"expiresAt": "2026-11-24T00:00:00"},
            {"reviewedAt": "2026-11-21T00:00:00Z"},
            {"expiresAt": "2027-11-24T00:00:00Z"},
            {"expiresAt": "2026-11-24T00:00:01Z"},
            {"expiresAt": "2026-11-16T00:00:00Z"},
        ]
        for values in invalid:
            with self.subTest(values=values):
                data = review()
                data["review"].update(values)
                with self.assertRaises(BACKPORT.BackportError):
                    self.load(data)

    def test_review_requires_owner_evidence_verified_status_and_complete_inventory(self):
        for key in ("owner", "evidence", "reviewedAt", "expiresAt"):
            with self.subTest(key=key):
                data = review()
                data["review"].pop(key)
                with self.assertRaises(BACKPORT.BackportError):
                    self.load(data)
        data = review()
        data["review"]["status"] = "pending"
        with self.assertRaises(BACKPORT.BackportError):
            self.load(data)
        data = review()
        data["releases"].pop("2.3.2")
        with self.assertRaises(BACKPORT.BackportError):
            self.load(data)


class BackportFindingCoverageTests(unittest.TestCase):
    def test_accepts_only_the_reviewed_leaf_and_complete_copy_inventory(self):
        data, lock, copies = findings()
        before = deepcopy(data)
        self.assertTrue(BACKPORT.raw_findings_covered(data, lock, copies))
        self.assertEqual(data, before, "classification must preserve raw findings and counts")

    def test_rejects_unknown_leaf_critical_count_mismatch_and_missing_copy(self):
        mutations = [
            lambda data: data["vulnerabilities"]["picomatch"]["via"][0].update(source=999),
            lambda data: data["vulnerabilities"]["picomatch"]["via"][0].update(range="*"),
            lambda data: data["vulnerabilities"]["picomatch"]["nodes"].pop(),
            lambda data: data["metadata"]["vulnerabilities"].update(high=0),
            lambda data: data["metadata"]["vulnerabilities"].update(critical=1),
            lambda data: data.update(error={"code": "network_failure"}),
        ]
        for mutate in mutations:
            data, lock, copies = findings()
            mutate(data)
            with self.subTest(data=data):
                self.assertFalse(BACKPORT.raw_findings_covered(data, lock, copies))

    def test_moderate_findings_remain_allowed_but_do_not_explain_a_high_parent(self):
        data, lock, copies = findings()
        lock["packages"]["node_modules/moderate"] = {}
        data["vulnerabilities"]["moderate"] = {
            "severity": "moderate", "nodes": ["node_modules/moderate"],
            "via": [{"severity": "moderate", "source": 99}],
        }
        data["vulnerabilities"]["consumer"]["via"].append("moderate")
        self.assertTrue(BACKPORT.raw_findings_covered(data, lock, copies))
        data["vulnerabilities"]["consumer"]["via"] = ["moderate"]
        self.assertFalse(BACKPORT.raw_findings_covered(data, lock, copies))

    def test_npm_aggregated_child_can_exceed_consumer_severity_without_hiding_high(self):
        data, lock, copies = findings()
        data["metadata"]["vulnerabilities"]["high"] = 1
        data["vulnerabilities"]["consumer"]["severity"] = "moderate"
        self.assertTrue(BACKPORT.raw_findings_covered(data, lock, copies))
        data["vulnerabilities"]["picomatch"]["via"][0]["source"] = 999
        self.assertFalse(BACKPORT.raw_findings_covered(data, lock, copies))

    def test_rejects_a_lower_severity_record_with_a_high_leaf(self):
        data, lock, copies = findings()
        data["metadata"]["vulnerabilities"]["high"] = 0
        for row in data["vulnerabilities"].values():
            row["severity"] = "moderate"
        self.assertFalse(BACKPORT.raw_findings_covered(data, lock, copies))

    def test_rejects_a_mixed_unknown_leaf_in_a_parent(self):
        data, lock, copies = findings()
        data["vulnerabilities"]["consumer"]["via"].append({
            "name": "consumer", "dependency": "consumer", "severity": "high",
            "source": 999, "url": "https://github.com/advisories/GHSA-test-other-advy",
        })
        self.assertFalse(BACKPORT.raw_findings_covered(data, lock, copies))

    def test_rejects_missing_via_and_cycles_without_recursing_forever(self):
        for via in (["missing"], ["consumer"], []):
            data, lock, copies = findings()
            data["vulnerabilities"]["consumer"]["via"] = via
            with self.subTest(via=via):
                self.assertFalse(BACKPORT.raw_findings_covered(data, lock, copies))

    def test_rejects_non_integer_negative_or_boolean_counts(self):
        for value in (False, True, 0.0, 2.0, -1, "2", None):
            data, lock, copies = findings()
            data["metadata"]["vulnerabilities"]["high"] = value
            with self.subTest(value=value):
                self.assertFalse(BACKPORT.raw_findings_covered(data, lock, copies))

    def test_rejects_unknown_npm_severity(self):
        data, lock, copies = findings()
        data["vulnerabilities"]["consumer"]["severity"] = "unknown"
        self.assertFalse(BACKPORT.raw_findings_covered(data, lock, copies))


class BackportLockInventoryTests(unittest.TestCase):
    def fixture(self):
        data, lock, copies = findings()
        lock["lockfileVersion"] = 3
        verified = review()
        verified["releases"]["4.0.4"] = {"integrity": "sha512-test-only", "tarball": "https://registry.npmjs.org/picomatch/-/picomatch-4.0.4.tgz"}
        for node, version in copies:
            lock["packages"][node] = {"version": version, "integrity": "sha512-test-only", "resolved": verified["releases"][version]["tarball"]}
        return data, lock, copies, verified

    def test_exact_registry_sources_and_versions_are_required_for_every_copy(self):
        _, lock, copies, verified = self.fixture()
        self.assertEqual(BACKPORT.reviewed_lock_copies(lock, verified), copies)
        for values in (
            {"version": "4.0.8"}, {"integrity": "different"},
            {"resolved": "https://untrusted.invalid/picomatch.tgz"}, {"link": True},
        ):
            _, lock, _, verified = self.fixture()
            lock["packages"]["node_modules/picomatch"].update(values)
            with self.subTest(values=values), self.assertRaises(BACKPORT.BackportError):
                BACKPORT.reviewed_lock_copies(lock, verified)


class BackportNpmAuditIntegrationTests(unittest.TestCase):
    def execute(self, data, *, verification_error=False):
        _, lock, _, verified = BackportLockInventoryTests().fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "frontend").mkdir()
            (root / "frontend/package-lock.json").write_text(json.dumps(lock))
            output = root / "reports"
            output.mkdir()
            raw_text = json.dumps(data, indent=3) + "\n"

            def npm(command, **kwargs):
                self.assertIn("--package-lock-only", command)
                self.assertIn("--audit-level=high", command)
                self.assertFalse({"KOVA_UPSTREAM_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"} & kwargs["env"].keys())
                kwargs["stdout"].write(raw_text)
                counts = data["metadata"]["vulnerabilities"]
                return type("Result", (), {"returncode": 1 if counts["high"] or counts["critical"] else 0})()

            with mock.patch.object(AUDIT, "ROOT", root), \
                    mock.patch.object(AUDIT, "NPM_LOCKS", ("frontend/package-lock.json",)), \
                    mock.patch.object(AUDIT.subprocess, "run", side_effect=npm), \
                    mock.patch.object(AUDIT.BACKPORT, "verify_install_contracts"), \
                    mock.patch.object(AUDIT.BACKPORT, "verify_recipes") as recipes:
                if verification_error:
                    recipes.side_effect = AUDIT.BACKPORT.BackportError("Unverified current recipes")
                else:
                    recipes.return_value = verified, {"status": "synthetic-test-only"}
                passed = AUDIT.audit_npm(output)
                self.assertEqual(recipes.call_count, 1)
                self.assertEqual((output / "npm-0.json").read_text(), raw_text)
                decisions = json.loads((output / "npm-security-decisions.json").read_text())
                return passed, decisions

    def test_clean_raw_with_picomatch_still_requires_current_recipe_verification(self):
        data = {"metadata": {"vulnerabilities": {"high": 0, "critical": 0}}, "vulnerabilities": {}}
        passed, decisions = self.execute(data, verification_error=True)
        self.assertFalse(passed)
        self.assertFalse(decisions[0]["passed"])
        self.assertIn("Unverified current recipes", decisions[0]["reason"])

    def test_covered_high_report_remains_intact_and_is_explained_separately(self):
        data, _, _ = findings()
        passed, decisions = self.execute(data)
        self.assertTrue(passed)
        self.assertEqual(decisions[0]["raw_counts"], {"high": 2, "critical": 0})
        self.assertTrue(decisions[0]["verified_local_backport"])

    def test_unknown_high_still_fails_after_successful_recipe_verification(self):
        data, _, _ = findings()
        data["vulnerabilities"]["picomatch"]["via"][0]["source"] = 999
        passed, decisions = self.execute(data)
        self.assertFalse(passed)
        self.assertFalse(decisions[0]["verified_local_backport"])


class BackportGlobalCatalogTests(unittest.TestCase):
    def test_untrusted_transport_targets_are_rejected_before_network(self):
        urls = (
            "http://api.github.com/advisories", "https://untrusted.invalid/advisories",
            "https://user@api.github.com/advisories", "https://api.github.com:4443/advisories",
            "https://registry.npmjs.org:443/picomatch", "https://api.github.com./advisories",
        )
        with mock.patch.object(BACKPORT, "build_opener") as opener:
            for url in urls:
                with self.subTest(url=url), self.assertRaises(BACKPORT.BackportError):
                    BACKPORT._fetch(url)
            opener.assert_not_called()

    def test_pagination_preserves_scope_and_queries_all_types(self):
        calls = []

        def fetch(url, **kwargs):
            calls.append(url)
            query = parse_qs(urlparse(url).query)
            if query["type"] == ["reviewed"] and query["is_withdrawn"] == ["false"]:
                if "after" not in query:
                    return json.dumps([advisory()]).encode(), f'<{url}&after=cursor>; rel="next"'
                return json.dumps([advisory("GHSA-3v7f-55p6-f55p")]).encode(), None
            return b"[]", None

        current = BACKPORT.current_advisories(fetch=fetch)
        self.assertEqual(len(current), 2)
        self.assertEqual(len(calls), 7)
        scopes = {(parse_qs(urlparse(url).query)["type"][0],
                   parse_qs(urlparse(url).query)["is_withdrawn"][0]) for url in calls}
        self.assertEqual(scopes, {(kind, withdrawn) for kind in ("reviewed", "unreviewed", "malware")
                                 for withdrawn in ("false", "true")})

    def test_captures_original_http_bytes_without_rewriting_the_feed(self):
        original = b"[  ]\n"
        pages = []
        self.assertEqual(BACKPORT.current_advisories(
            fetch=lambda *args, **kwargs: (original, None), raw_pages=pages,
        ), [])
        self.assertEqual(len(pages), 6)
        self.assertEqual(base64.b64decode(pages[0]["body_base64"]), original)
        self.assertRegex(pages[0]["sha256"], r"^[0-9a-f]{64}$")

    def test_rejects_cross_host_scope_or_cursor_loops(self):
        for next_link in (
            "https://untrusted.invalid/advisories", "http://api.github.com/advisories",
            "https://api.github.com/advisories?ecosystem=npm&affects=another-package",
            "repeat",
        ):
            def fetch(url, **kwargs):
                target = url if next_link == "repeat" else next_link
                return b"[]", f'<{target}>; rel="next"'
            with self.subTest(next_link=next_link), self.assertRaises(BACKPORT.BackportError):
                BACKPORT.current_advisories(fetch=fetch)

    def test_rejects_malformed_response_and_changed_query_type(self):
        for response in (b"{}", b"invalid-json", json.dumps([advisory() | {"type": "malware"}]).encode()):
            with self.subTest(response=response), self.assertRaises((BACKPORT.BackportError, ValueError)):
                BACKPORT.current_advisories(fetch=lambda *args, **kwargs: (response, None))

    def test_rejects_identical_duplicate_advisory_within_page(self):
        body = json.dumps([advisory(), advisory()]).encode()
        with self.assertRaises(BACKPORT.BackportError):
            BACKPORT.current_advisories(fetch=lambda *args, **kwargs: (body, None))

    def test_rejects_full_page_without_verifiable_continuation(self):
        body = json.dumps([advisory(f"GHSA-{index:04x}-abcd-efgh") for index in range(100)]).encode()
        with self.assertRaises(BACKPORT.BackportError):
            BACKPORT.current_advisories(fetch=lambda *args, **kwargs: (body, None))

    def test_catalog_changes_missing_entries_or_updated_dates_require_review(self):
        expected = [advisory(), advisory("GHSA-3v7f-55p6-f55p"), advisory("GHSA-c2c7-rcm5-vvqj")]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "advisories.json").write_text(json.dumps(expected))
            current = sorted((BACKPORT.normalize_advisory(row) for row in expected), key=lambda row: row["ghsa_id"])
            BACKPORT.validate_catalog(current, source)
            changed = deepcopy(current)
            changed[0]["updated_at"] = "2026-11-18T00:00:00Z"
            for mutation in (changed, current[:-1], [*current, advisory("GHSA-neww-advy-test")]):
                with self.subTest(mutation=mutation), self.assertRaises(BACKPORT.BackportError):
                    BACKPORT.validate_catalog(mutation, source)


if __name__ == "__main__":
    unittest.main()
