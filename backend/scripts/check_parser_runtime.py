"""Verify the isolated parser's real custom binaries and current upstream advisories.

The public GitHub lookup runs on the host without credentials. The image probe
runs without network, writable root filesystem, elevated capabilities or secrets.
OS/SCA scans remain separate: custom source builds need explicit provenance.
"""

import argparse
import hashlib
import json
import platform
import re
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

ADVISORY_URL = "https://api.github.com/repos/tesseract-ocr/tesseract/security-advisories"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
EXPECTED_CVES = {f"CVE-2026-{number}" for number in (86138, 86139, 86140, 86142, 86143, 86144)}
EXPECTED_SUITES = {
    "intproto_test",
    "intproto_addclass_test",
    "unicharset_load_test",
    "weightmatrix_deserialize_test",
    "weightmatrix_scales_test",
    "weightmatrix_intdim_test",
    "lstm_recoder_test",
    "lstm_nullchar_test",
    "recoder_test",
    "matrix_deserializesize_test",
    "normproto_test",
    "adaptive_test",
    "adaptive_templates_test",
    "fullyconnected_test",
    "lstm_layer_test",
    "genericvector_test",
    "plumbing_test",
}
SOURCE_ROOT = Path(__file__).resolve().parents[1] / "assistant-parser"
XML_SOURCE_SHA = "a2c9ae7b770da34860050c309f903221c67830c86e4a7e760692b803df95143a"


class GateError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _sha(value) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def load_expected(source_root: Path = SOURCE_ROOT) -> dict:
    manifest = json.loads((source_root / "upstream-security.json").read_text())
    patches = json.loads((source_root / "libxml2-patches/provenance.json").read_text())
    if len(patches) != 6 or {row["cve"] for row in patches} != EXPECTED_CVES:
        raise GateError("Incomplete six-CVE libxml2 patch set")
    advisories = manifest.get("advisories", [])
    identifiers = [row.get("ghsa_id") for row in advisories]
    if (
        len(identifiers) < 19
        or len(set(identifiers)) != len(identifiers)
        or any(
            not isinstance(value, str)
            or not re.fullmatch(
                r"GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}",
                value,
            )
            for value in identifiers
        )
    ):
        raise GateError("Incomplete reviewed OCR advisory inventory")
    if (
        not re.fullmatch(r"[0-9a-f]{40}", manifest["source"]["commit"])
        or not _sha(manifest["source"]["sha256"])
        or not _sha(manifest["model"]["sha256"])
    ):
        raise GateError("Invalid pinned OCR source or model")
    source_files = {}
    for row in advisories:
        name, digest = row["source_file"], row["source_sha256"]
        if (
            not isinstance(name, str)
            or not name.startswith("src/")
            or ".." in Path(name).parts
            or not _sha(digest)
            or source_files.get(name, digest) != digest
        ):
            raise GateError("Invalid OCR source-file provenance")
        source_files[name] = digest
    files = {}
    for row in patches:
        names = [(row["cve"] + ".patch", row["sha256"])]
        if row.get("backport_file"):
            names.append((row["backport_file"], row["backport_sha256"]))
        for name, digest in names:
            if Path(name).name != name or not _sha(digest):
                raise GateError("Invalid libxml2 patch provenance")
            if (
                hashlib.sha256((source_root / "libxml2-patches" / name).read_bytes()).hexdigest()
                != digest
            ):
                raise GateError("Repository libxml2 patch hash mismatch")
            files[name] = digest
    tests = {
        name: hashlib.sha256(
            (source_root / "libxml2-tests" / (name + ".c")).read_bytes()
        ).hexdigest()
        for name in sorted(EXPECTED_CVES)
    }
    return {
        "manifest": manifest,
        "patches": patches,
        "patch_files": files,
        "test_files": tests,
        "source_files": source_files,
    }


def _next_page(link: str | None) -> str | None:
    matches = re.findall(r'<([^>]+)>;\s*rel="next"', link or "")
    if not matches:
        return None
    if len(matches) != 1:
        raise GateError("Ambiguous advisory pagination")
    parsed = urlparse(matches[0])
    expected = urlparse(ADVISORY_URL)
    query = parse_qs(parsed.query)
    if (
        parsed.scheme != "https"
        or parsed.netloc != expected.netloc
        or parsed.path != expected.path
        or parsed.fragment
        or query.get("per_page") != ["100"]
        or not set(query).issubset({"per_page", "page", "after", "before", "state"})
        or any(len(values) != 1 for values in query.values())
        or ("state" in query and query["state"] != ["published"])
    ):
        raise GateError("Unsafe advisory pagination")
    return matches[0]


def check_upstream_advisories(expected: dict, *, open_url=None) -> list[str]:
    """Fetch every published page, never filtering away low/unknown severities."""
    if open_url is None:
        open_url = build_opener(NoRedirect()).open
    url = ADVISORY_URL + "?per_page=100&state=published"
    visited, identifiers = set(), set()
    try:
        for _page in range(100):
            if url in visited:
                raise GateError("Repeated advisory pagination")
            visited.add(url)
            request = Request(
                url,
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "kova-parser-security-gate",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
            with open_url(request, timeout=20) as response:
                if response.status != 200:
                    raise GateError("Public advisory lookup did not return HTTP 200")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise GateError("Oversized public advisory response")
                rows = json.loads(raw)
                link = response.headers.get("Link")
            if not isinstance(rows, list) or len(rows) > 100:
                raise GateError("Invalid public advisory response")
            for row in rows:
                identifier = row.get("ghsa_id") if isinstance(row, dict) else None
                if not isinstance(identifier, str) or not re.fullmatch(
                    r"GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}",
                    identifier,
                ):
                    raise GateError("Invalid public advisory identifier")
                if identifier in identifiers:
                    raise GateError("Duplicate advisory across pages")
                identifiers.add(identifier)
            reviewed = {row["ghsa_id"] for row in expected["manifest"]["advisories"]}
            unreviewed = identifiers - reviewed
            if unreviewed:
                raise GateError(
                    "Unreviewed upstream OCR advisories: " + ", ".join(sorted(unreviewed))
                )
            if len(rows) < 100:
                if _next_page(link) is not None:
                    raise GateError("Unexpected continuation after short advisory page")
                # A feed that silently omits reviewed published advisories is
                # incomplete too; do not mistake an empty/transient feed for clean.
                if not reviewed.issubset(identifiers):
                    raise GateError("Public advisory feed omitted reviewed advisories")
                return sorted(identifiers)
            url = _next_page(link)
            if url is None:
                raise GateError("Full advisory page has no verifiable continuation")
        raise GateError("Advisory pagination limit exceeded")
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        raise GateError("Public advisory lookup failed; cannot certify current coverage") from exc


PROBE = r"""
import ctypes, hashlib, json, os, pathlib, platform, re, subprocess, xml.etree.ElementTree as ET
import importlib.util
assert importlib.util.find_spec("pip") is None, "Runtime package installer must be absent"
assert os.getuid() == 65534 and os.getgid() == 65534
assert platform.machine() in {"x86_64", "aarch64"}
def read(path):
    return json.loads(pathlib.Path(path).read_text())
def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def junit(path):
    root = ET.parse(path).getroot()
    cases = list(root.iter("testcase"))
    if not cases or any(case.find("failure") is not None or case.find("error") is not None
                        for case in cases):
        raise ValueError("Missing or failed regression cases")
    return {"tests": len(cases), "failures": 0, "errors": 0,
            "skipped": sum(case.find("skipped") is not None for case in cases)}
xml = pathlib.Path("/usr/share/kova-parser/libxml2")
provenance = read(xml / "provenance.json")
library = pathlib.Path("/usr/lib/libxml2.so.2").resolve(strict=True)
loaded = ctypes.CDLL("/usr/lib/libxml2.so.2")
runtime_version = ctypes.c_char_p.in_dll(loaded, "xmlParserVersion").value.decode()
patches = {path.name: digest(path) for path in (xml / "patches").glob("*.patch")}
test_files = {path.stem: digest(path) for path in (xml / "tests").glob("CVE-*.c")}
ocr = pathlib.Path("/usr/local/share/kova-parser")
manifest = read(ocr / "upstream-security.json")
build = read(ocr / "tesseract-build.json")
binary = pathlib.Path("/usr/local/bin/tesseract")
model = pathlib.Path("/usr/local/share/tessdata/spa.traineddata")
version = subprocess.run([str(binary), "--version"], check=True, capture_output=True,
                         text=True, timeout=10).stdout.splitlines()[0]
summary = read(ocr / "upstream-tests/summary.json")
suites = {}
for path in sorted((ocr / "upstream-tests").glob("*_test.xml")):
    suites[path.stem] = junit(path)
print(json.dumps({"uid": os.getuid(), "architecture": platform.machine(),
    "libxml2": {"provenance": provenance,
        "library": {"path": str(library), "sha256": digest(library)},
        "runtime_version": runtime_version, "patch_files": patches, "test_files": test_files,
        "backports": read(xml / "tests/backports.json"),
        "upstream": junit(xml / "tests/upstream.xml")},
    "ocr": {"manifest": manifest, "build": build, "version": version,
        "binary_sha256": digest(binary), "model_sha256": digest(model),
        "summary": summary, "suites": suites}}))
"""


def validate_report(report: dict, expected: dict) -> None:
    if not isinstance(report, dict):
        raise GateError("Invalid parser runtime report")
    if report.get("uid") != 65534 or report.get("architecture") not in {"x86_64", "aarch64"}:
        raise GateError(
            "Parser must run as configured unprivileged user on a supported architecture"
        )
    xml = report["libxml2"]
    provenance = xml["provenance"]
    if (
        provenance.get("name") != "libxml2"
        or provenance.get("version") != "2.13.9-r2"
        or provenance.get("source_sha256") != XML_SOURCE_SHA
        or xml.get("runtime_version") != "21309"
        or xml["library"].get("path") != "/usr/lib/libxml2.so.2.13.9"
        or not _sha(xml["library"].get("sha256"))
        or provenance.get("library_sha256") != xml["library"]["sha256"]
    ):
        raise GateError("Actual libxml2 binary/version does not match truthful provenance")
    if (
        provenance.get("patches") != expected["patches"]
        or xml.get("patch_files") != expected["patch_files"]
        or xml.get("test_files") != expected["test_files"]
    ):
        raise GateError("Runtime six-CVE patch/test hashes do not match reviewed source")
    backports = xml["backports"]
    if (
        backports.get("regressions") != 6
        or backports.get("failures") != 0
        or backports.get("skipped") != 0
        or len(backports.get("passed", [])) != 6
        or set(backports["passed"]) != EXPECTED_CVES
    ):
        raise GateError("The complete six-CVE PASS regression report is required")
    upstream = xml["upstream"]
    if upstream.get("tests", 0) < 1 or any(
        upstream.get(key) != 0 for key in ("failures", "errors", "skipped")
    ):
        raise GateError("libxml2 upstream regressions must all pass")
    ocr = report["ocr"]
    manifest = expected["manifest"]
    build = ocr["build"]
    if (
        ocr.get("manifest") != manifest
        or build["source"].get("commit") != manifest["source"]["commit"]
        or build["source"].get("sha256") != manifest["source"]["sha256"]
        or build["source"].get("files") != expected["source_files"]
        or not re.fullmatch(
            r"tesseract " + re.escape(manifest["source"]["version"]) + r"(?:[ -].*)?",
            ocr.get("version", ""),
        )
    ):
        raise GateError("OCR source commit/files or actual version differ from reviewed provenance")
    if (
        build["binary"].get("path") != "/usr/local/bin/tesseract"
        or not _sha(ocr.get("binary_sha256"))
        or build["binary"].get("sha256") != ocr["binary_sha256"]
        or build["model"].get("path") != "/usr/local/share/tessdata/spa.traineddata"
        or build["model"].get("sha256") != manifest["model"]["sha256"]
        or ocr.get("model_sha256") != manifest["model"]["sha256"]
    ):
        raise GateError("OCR runtime binary or fixed Spanish model hash mismatch")
    suites = ocr["suites"]
    summary = ocr["summary"]
    if set(suites) != EXPECTED_SUITES or summary.get("suites") != 17:
        raise GateError("All 17 OCR regression suites must be present")
    totals = {
        key: sum(row[key] for row in suites.values())
        for key in ("tests", "failures", "errors", "skipped")
    }
    if (
        any(row.get("tests", 0) < 1 for row in suites.values())
        or any(summary.get(key) != value for key, value in totals.items())
        or totals["failures"]
        or totals["errors"]
        or summary.get("architecture") != report["architecture"]
    ):
        raise GateError("OCR summary does not prove successful executed regressions")
    skips = summary.get("skipped_cases", [])
    if not isinstance(skips, list) or totals["skipped"] != len(skips):
        raise GateError("OCR skipped cases are not fully accounted for")
    if any(
        row.get("suite") != "weightmatrix_intdim_test"
        or "no SIMD int backend active" not in row.get("reason", "")
        for row in skips
    ):
        raise GateError("Unexpected skipped OCR security regression")
    if any(row["skipped"] for name, row in suites.items() if name != "weightmatrix_intdim_test"):
        raise GateError("Unexpected skipped OCR security regression suite")


def native_execution_evidence(identity: str, required: str, *, run) -> dict:
    """Require matching Linux host, Docker server and immutable image architectures.

    Together with the runtime/build checks this rejects cross-architecture QEMU
    runs. Runner provenance remains separate; this is not hardware attestation.
    """
    platforms = {"x86_64": "linux/amd64", "aarch64": "linux/arm64"}
    aliases = {"x86_64": "x86_64", "amd64": "x86_64",
               "aarch64": "aarch64", "arm64": "aarch64"}
    host_os, host_arch = platform.system(), platform.machine()
    if required not in platforms or host_os != "Linux" or aliases.get(host_arch) != required:
        raise GateError("Native parser validation requires the requested Linux host architecture")
    server = run(
        ["docker", "info", "--format", "{{.Architecture}}"],
        check=True, capture_output=True, text=True, timeout=30,
    ).stdout.strip()
    image_platform = run(
        ["docker", "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", identity],
        check=True, capture_output=True, text=True, timeout=30,
    ).stdout.strip()
    if aliases.get(server) != required or image_platform != platforms[required]:
        raise GateError("Docker server and immutable parser image must match the native host")
    return {"required_architecture": required, "host_os": host_os,
            "host_architecture": host_arch, "docker_server_architecture": server,
            "image_platform": image_platform}


def check_image(image: str, *, run=None, source_root: Path = SOURCE_ROOT,
                require_native_arch: str | None = None) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,254}", image):
        raise GateError("Invalid local candidate image reference")
    expected = load_expected(source_root)
    if run is None:
        run = subprocess.run
    try:
        inspection = run(
            ["docker", "image", "inspect", "--format", "{{.Id}}", image],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        identity = inspection.stdout.strip()
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", identity):
            raise GateError("Cannot resolve immutable local candidate image")
        native = None
        if require_native_arch is not None:
            native = native_execution_evidence(identity, require_native_arch, run=run)
        result = run(
            [
                "docker",
                "run",
                "--rm",
                "--pull=never",
                "--network=none",
                "--read-only",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--memory=256m",
                "--cpus=1",
                "--pids-limit=64",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,nodev,size=32m",
                "--entrypoint",
                "/usr/local/bin/python",
                identity,
                "-I",
                "-c",
                PROBE,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=90,
        )
        if len(result.stdout.encode()) > MAX_RESPONSE_BYTES:
            raise GateError("Oversized parser runtime report")
        report = json.loads(result.stdout)
        validate_report(report, expected)
        if require_native_arch is not None:
            if report["architecture"] != require_native_arch:
                raise GateError("Parser runtime architecture differs from the required native host")
            report["native_execution"] = native
        return {"image_id": identity, **report}
    except (
        subprocess.SubprocessError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
    ) as exc:
        raise GateError("Candidate parser runtime verification failed") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--require-native-arch", choices=("x86_64", "aarch64"),
                        help="Require matching Linux host, Docker server, image and runtime")
    args = parser.parse_args()
    try:
        expected = load_expected()
        advisory_ids = check_upstream_advisories(expected)
        report = check_image(args.image, require_native_arch=args.require_native_arch)
        report["status"] = "passed"
        report["upstream_advisory_ids"] = advisory_ids
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(
            json.dumps(
                {
                    "image_id": report["image_id"],
                    "architecture": report["architecture"],
                    "native_execution": report.get("native_execution"),
                    "reviewed_advisories": len(advisory_ids),
                    "libxml2_regressions": 6,
                    "ocr_suites": 17,
                    "ocr_skipped": report["ocr"]["summary"]["skipped"],
                }
            )
        )
        return 0
    except Exception as exc:
        error = str(exc) if isinstance(exc, GateError) else "Invalid or unavailable gate input"
        if args.report:
            try:
                args.report.parent.mkdir(parents=True, exist_ok=True)
                args.report.write_text(json.dumps({"status": "failed", "error": error}) + "\n")
            except OSError:
                print("Could not write the parser gate failure artifact", file=sys.stderr)
        print(f"Parser security gate failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
