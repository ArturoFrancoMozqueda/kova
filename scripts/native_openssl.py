"""Verify the temporary OpenSSL build without the affected QUIC component."""

from datetime import UTC, datetime

PACKAGE = "libssl3t64"
VERSION = "3.5.9-1~deb13u1"
SOURCE_SHA256 = "b038dfab5ee111242b7439e07c820d228519273e7fd1f514014b039e929aad9f"
REVIEW_EXPIRES = datetime(2026, 12, 2, 3, 50, tzinfo=UTC)
QUIC_ADVISORIES = {"CVE-2026-107494", "CVE-2026-124709"}

PROBE = r'''
import ctypes, hashlib, json, ssl, sys
from pathlib import Path

root = Path('/usr/share/kova')
build = json.loads((root / 'openssl-build.json').read_text())
runtime = json.loads((root / 'native-runtime.json').read_text())
package, version, source_sha = sys.argv[1:]
assert build['configure'] == 'no-quic' and build['dsc_sha256'] == source_sha
assert build['package_version'] == version and ssl.OPENSSL_VERSION.split()[1] == version.split('-', 1)[0]
installed, = (item for item in runtime['debian_libraries'] if item['name'] == package)
assert installed['status'] == 'var/lib/dpkg/status.d/' + package
fields = Path('/', installed['status']).read_text().splitlines()
assert 'Package: ' + package in fields and 'Version: ' + version in fields
mapped = {line.split()[-1] for line in Path('/proc/self/maps').read_text().splitlines()}
libssl, = (path for path in mapped if path.endswith('/libssl.so.3'))
libcrypto, = (path for path in mapped if path.endswith('/libcrypto.so.3'))
for path in (libssl, libcrypto):
    assert path.startswith('/usr/lib/') and path in installed['sha256']
    assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == installed['sha256'][path]
assert installed['sha256'][libssl] == build['libssl_sha256']
library = ctypes.CDLL(libssl)
assert not any(hasattr(library, symbol) for symbol in (
    'OSSL_QUIC_server_method', 'OSSL_QUIC_client_method', 'OSSL_QUIC_client_thread_method',
    'SSL_inject_net_dgram',
))
assert ssl.create_default_context().cert_store_stats()['x509_ca'] > 0
print(json.dumps({'package_version': version, 'libssl_sha256': build['libssl_sha256'], 'quic': False}))
'''


def reviewed_advisories(report: dict, now: datetime | None = None) -> list[str]:
    if (now or datetime.now(UTC)) >= REVIEW_EXPIRES:
        return []
    os = report.get("Metadata", {}).get("OS", {})
    if os.get("Family") != "debian" or str(os.get("Name", "")).split(".")[0] != "13":
        return []
    covered = set()
    for result in report["Results"]:
        for finding in result.get("Vulnerabilities") or []:
            if finding["Severity"] not in {"HIGH", "CRITICAL"}:
                continue
            if (result["Class"] != "os-pkgs" or result.get("Type") != "debian"
                    or finding["Severity"] != "HIGH" or finding["PkgName"] != PACKAGE
                    or finding["InstalledVersion"] != VERSION or finding.get("FixedVersion")
                    or finding["VulnerabilityID"] not in QUIC_ADVISORIES):
                return []
            covered.add(finding["VulnerabilityID"])
    return sorted(covered)
