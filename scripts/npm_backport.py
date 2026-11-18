"""Verify a time-bounded local security backport without hiding registry advisories.

The raw npm report is immutable. A non-zero audit is acceptable only when every
HIGH finding leads exclusively to the reviewed CVE and the exact shipped recipe
has been reconstructed and tested from integrity-checked official release bytes.
Unknown advisories, bytes, locations, versions, errors or expired reviews fail.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import subprocess
import tarfile
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend/scripts/security/picomatch"
VERIFIER = ROOT / "frontend/scripts/security/picomatch.mjs"
GHSA = "GHSA-fc5q-39xc-vjpf"
CVE = "CVE-2026-112366"
MAX_BYTES = 2 * 1024 * 1024


class BackportError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def load_review(source: Path = SOURCE, now: datetime | None = None) -> tuple[dict, str]:
    raw = (source / "manifest.json").read_bytes()
    data = json.loads(raw)
    review = data.get("review", {})
    try:
        expiry_text = review["expiresAt"]
        reviewed_text = review["reviewedAt"]
        if not isinstance(expiry_text, str) or not isinstance(reviewed_text, str):
            raise ValueError("Review timestamps must be strings")
        expiry = datetime.fromisoformat(expiry_text.replace("Z", "+00:00"))
        reviewed_at = datetime.fromisoformat(reviewed_text.replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError) as error:
        raise BackportError("Invalid security backport review dates") from error
    current = now or datetime.now(UTC)
    if (data.get("advisory") != GHSA or review.get("status") != "verified"
            or not review.get("owner") or not review.get("evidence")
            or expiry.tzinfo is None or reviewed_at.tzinfo is None or current.tzinfo is None):
        raise BackportError("Security backport review is expired, absent or unverified")
    if (reviewed_at > current or expiry <= reviewed_at
            or expiry - reviewed_at > timedelta(days=7) or current >= expiry):
        raise BackportError("Security backport review is expired, absent or unverified")
    if set(data.get("releases", {})) != {"2.3.2", "4.0.4", "4.0.7"}:
        raise BackportError("Unreviewed picomatch release inventory")
    return data, hashlib.sha256(raw).hexdigest()


def verify_install_contracts(root: Path = ROOT) -> None:
    """All supported CI/release installs patch before any dependency lifecycle."""
    for workflow in (root / ".github/workflows").glob("*.y*ml"):
        if re.search(r"\bnpm\s+(?:ci|install)\b", workflow.read_text()):
            raise BackportError("Workflow bypasses verified npm installation")
    for relative in (".github/workflows/ci.yml", ".github/workflows/native-backend.yml",
                     ".github/workflows/stripe-sandbox-drill.yml", "scripts/test-stack.sh"):
        contents = (root / relative).read_text()
        if re.search(r"\bnpm\s+ci\b", contents) or "scripts/security/install.mjs" not in contents:
            raise BackportError("Unverified npm installation route")
    docker = (root / "frontend/Dockerfile").read_text()
    if ("RUN node scripts/security/install.mjs" not in docker or
            docker.find("COPY scripts/security") > docker.find("RUN node scripts/security/install.mjs")
            or "COPY scripts/security" not in docker):
        raise BackportError("Docker does not install the verified recipe before tooling")
    for relative, prefix in (("frontend", "scripts/security/"),
                             ("deploy/cloudflare-backend", "../../frontend/scripts/security/")):
        scripts = json.loads((root / relative / "package.json").read_text())["scripts"]
        for task in ("prebuild", "pretest"):
            if scripts.get(task) != f"node {prefix}picomatch.mjs --verify":
                raise BackportError("Tooling must verify installed runtime bytes before execution")


def _fetch(url: str, *, token: str | None = None) -> tuple[bytes, str | None]:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc not in {"api.github.com", "registry.npmjs.org"}:
        raise BackportError("Untrusted security source")
    headers = {"User-Agent": "Kova-dependency-security", "Accept": "application/vnd.github+json"}
    if token and parsed.hostname == "api.github.com":
        headers["Authorization"] = f"Bearer {token}"
    with build_opener(NoRedirect).open(Request(url, headers=headers), timeout=30) as response:
        if response.status != 200:
            raise BackportError("Security source did not return HTTP 200")
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise BackportError("Oversized security source")
        return body, response.headers.get("Link")


def normalize_advisory(row: dict) -> dict:
    required = ("ghsa_id", "cve_id", "html_url", "severity", "type", "updated_at", "withdrawn_at")
    if not all(key in row for key in required) or not isinstance(row.get("vulnerabilities"), list):
        raise BackportError("Incomplete global advisory")
    result = {key: row[key] for key in required}
    entries = []
    for item in row["vulnerabilities"]:
        if item.get("package") != {"ecosystem": "npm", "name": "picomatch"}:
            raise BackportError("Unexpected package in global picomatch catalog")
        entries.append({key: item[key] for key in (
            "first_patched_version", "package", "vulnerable_functions", "vulnerable_version_range",
        )})
    result["vulnerabilities"] = sorted(entries, key=lambda value: json.dumps(value, sort_keys=True))
    return result


def current_advisories(
    fetch=_fetch, token: str | None = None, raw_pages: list[dict] | None = None,
) -> list[dict]:
    """Global catalog, all review types and withdrawn notices, bounded pagination."""
    found = {}
    for kind, withdrawn in ((kind, withdrawn) for kind in ("reviewed", "unreviewed", "malware")
                            for withdrawn in (False, True)):
        url = "https://api.github.com/advisories?" + urlencode({
            "ecosystem": "npm", "affects": "picomatch", "type": kind,
            "is_withdrawn": str(withdrawn).lower(), "per_page": 100,
        })
        visited = set()
        while url:
            if url in visited or len(visited) >= 20:
                raise BackportError("Unbounded global advisory pagination")
            visited.add(url)
            raw, links = fetch(url, token=token)
            if raw_pages is not None:
                raw_pages.append({
                    "url": url, "link": links,
                    "body_base64": base64.b64encode(raw).decode("ascii"),
                    "sha256": hashlib.sha256(raw).hexdigest(),
                })
            rows = json.loads(raw)
            if not isinstance(rows, list) or len(rows) > 100:
                raise BackportError("Invalid global advisory response")
            for row in rows:
                normalized = normalize_advisory(row)
                if normalized["type"] != kind or bool(normalized["withdrawn_at"]) != withdrawn:
                    raise BackportError("Global advisory response changed query scope")
                identity = normalized["ghsa_id"]
                if identity in found:
                    raise BackportError("Duplicate global advisory across pages")
                found[identity] = normalized
            next_urls = re.findall(r'<([^>]+)>;\s*rel="next"', links or "")
            if len(next_urls) > 1:
                raise BackportError("Ambiguous global advisory pagination")
            if len(rows) == 100 and not next_urls:
                raise BackportError("Full global advisory page has no verifiable continuation")
            url = next_urls[0] if next_urls else None
            if url:
                parsed = urlparse(url)
                query = parse_qs(parsed.query)
                if (parsed.scheme != "https" or parsed.netloc != "api.github.com"
                        or parsed.path != "/advisories" or query.get("ecosystem") != ["npm"]
                        or query.get("affects") != ["picomatch"] or query.get("type") != [kind]
                        or query.get("is_withdrawn") != [str(withdrawn).lower()]):
                    raise BackportError("Global advisory pagination changed scope")
    return [found[key] for key in sorted(found)]


def validate_catalog(current: list[dict], source: Path = SOURCE) -> None:
    expected = json.loads((source / "advisories.json").read_text())
    expected = sorted((normalize_advisory(row) for row in expected), key=lambda row: row["ghsa_id"])
    if current != expected or {row["ghsa_id"] for row in current} != {
        GHSA, "GHSA-3v7f-55p6-f55p", "GHSA-c2c7-rcm5-vvqj",
    }:
        raise BackportError("Global picomatch advisory catalog changed: review required")


def reviewed_lock_copies(lock: dict, review: dict) -> list[tuple[str, str]]:
    if lock.get("lockfileVersion") != 3 or not isinstance(lock.get("packages"), dict):
        raise BackportError("Unreviewed npm lock inventory")
    copies = []
    for name, entry in lock["packages"].items():
        if not re.search(r"(?:^|/)node_modules/picomatch$", name):
            continue
        version = entry.get("version")
        release = review["releases"].get(version)
        if (not release or entry.get("link") or entry.get("integrity") != release["integrity"]
                or entry.get("resolved") != release["tarball"]):
            raise BackportError("Unreviewed picomatch version or registry integrity")
        copies.append((name, version))
    return copies


def raw_findings_covered(data: dict, lock: dict, copies: list[tuple[str, str]]) -> bool:
    """Follow every HIGH metavulnerability to an exact, reviewed advisory leaf."""
    if data.get("error"):
        return False
    try:
        counts = data["metadata"]["vulnerabilities"]
        records = data["vulnerabilities"]
        if any(type(counts[key]) is not int or counts[key] < 0 for key in ("high", "critical")):
            return False
        if not isinstance(records, dict) or any(not isinstance(row, dict) for row in records.values()):
            return False
        if any(row.get("severity") not in {"info", "low", "moderate", "high", "critical"}
               for row in records.values()):
            return False
        ranks = {name: index for index, name in enumerate(("info", "low", "moderate", "high", "critical"))}
        for row in records.values():
            for via in row.get("via", []):
                if not isinstance(via, (str, dict)):
                    return False
                severity = records.get(via, {}).get("severity") if isinstance(via, str) else via.get("severity")
                # npm aggregates a dependency across versions; a named child's
                # severity can exceed this consumer's affected version range.
                # Every HIGH child is checked independently below.
                if severity not in ranks or (isinstance(via, dict) and ranks[severity] > ranks[row["severity"]]):
                    return False
        high = {name for name, row in records.items() if row["severity"] == "high"}
        critical = {name for name, row in records.items() if row["severity"] == "critical"}
        if counts["high"] != len(high) or counts["critical"] != len(critical) or critical:
            return False
        expected_nodes = {path for path, _ in copies}
        if "picomatch" in records and set(records["picomatch"]["nodes"]) != expected_nodes:
            return False

        def covered(name: str, chain: frozenset[str]) -> bool:
            if name in chain or name not in records:
                return False
            row = records[name]
            if (not row.get("via") or not row.get("nodes")
                    or any(node not in lock["packages"] for node in row["nodes"])):
                return False
            explained = False
            for via in row["via"]:
                if isinstance(via, str):
                    # A HIGH parent may also have independent MODERATE leaves;
                    # the ordinary policy retains those without blocking them.
                    if records[via]["severity"] != "high":
                        continue
                    if not covered(via, chain | {name}):
                        return False
                    explained = True
                elif via["severity"] == "high":
                    if (name != "picomatch"
                            or via.get("name") != "picomatch" or via.get("dependency") != "picomatch"
                            or via.get("url") != f"https://github.com/advisories/{GHSA}"
                            or via.get("source") != 1247710 or via.get("range") != "<=4.0.7"):
                        return False
                    explained = True
            return explained

        return all(covered(name, frozenset()) for name in high)
    except (KeyError, TypeError, ValueError):
        return False


def reconstruct_release(version: str, release: dict, directory: Path, *, fetch=_fetch) -> dict:
    if release["tarball"] != f"https://registry.npmjs.org/picomatch/-/picomatch-{version}.tgz":
        raise BackportError("Unexpected release source")
    blob, _ = fetch(release["tarball"])
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(blob).digest()).decode()
    if integrity != release["integrity"]:
        raise BackportError("Official release archive integrity mismatch")
    target = directory / version
    target.mkdir()
    files = release["files"]
    observed = set()
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
        total = 0
        for member in archive:
            total += member.size
            if total > 8 * MAX_BYTES or member.issym() or member.islnk():
                raise BackportError("Unsafe release archive")
            if not member.isfile():
                continue
            if not member.name.startswith("package/"):
                raise BackportError("Unexpected release archive path")
            name = member.name.removeprefix("package/")
            if ".." in Path(name).parts or Path(name).is_absolute():
                raise BackportError("Release path traversal")
            if not re.search(r"\.(?:[cm]?js|json)$", name):
                continue
            if name in observed or name not in files:
                raise BackportError("Release executable inventory mismatch")
            content = archive.extractfile(member).read()
            if hashlib.sha256(content).hexdigest() != files[name]["before"]:
                raise BackportError("Official release preimage mismatch")
            observed.add(name)
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    if observed != set(files):
        raise BackportError("Incomplete official release archive")
    # No application/provider credentials are passed to third-party library tests.
    result = subprocess.run([
        "node", str(VERIFIER), "--copy", str(target), "--version", version, "--apply", "--probe",
    ], check=False, capture_output=True, text=True, timeout=150,
       env={"PATH": os.environ.get("PATH", ""), "NODE_ENV": "test"})
    if result.returncode != 0:
        raise BackportError(f"Backport reconstruction/regressions failed for picomatch {version}")
    evidence = json.loads(result.stdout)
    if evidence.get("protocol") != "kova-picomatch-backport-v1" or len(evidence.get("copies", [])) != 1:
        raise BackportError("Invalid backport reconstruction evidence")
    return evidence


def verify_recipes(output: Path, *, token: str | None = None) -> tuple[dict, dict]:
    review, digest = load_review()
    raw_pages: list[dict] = []
    try:
        catalog = current_advisories(token=token, raw_pages=raw_pages)
    finally:
        (output / "picomatch-upstream-pages.json").write_text(
            json.dumps(raw_pages, indent=2) + "\n"
        )
    (output / "picomatch-upstream.json").write_text(json.dumps(catalog, indent=2) + "\n")
    validate_catalog(catalog)
    with tempfile.TemporaryDirectory(prefix="kova-picomatch-security-") as directory:
        evidence = {version: reconstruct_release(version, release, Path(directory))
                    for version, release in review["releases"].items()}
    if any(item.get("manifest_sha256") != digest for item in evidence.values()):
        raise BackportError("Backport evidence and reviewed manifest differ")
    report = {"status": "verified-local-remediation", "registry_advisory": GHSA, "cve": CVE,
              "registry_release_affected": True, "manifest_sha256": digest,
              "review": review["review"], "reconstructed": evidence}
    (output / "picomatch-backport.json").write_text(json.dumps(report, indent=2) + "\n")
    return review, report
