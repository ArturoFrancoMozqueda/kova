#!/usr/bin/env python3
"""Read-only resident API acceptance: contracts, identity and warm latency.

No account creation, sign-in, emails or business writes. Never log response
bodies, cookies, credentials or arbitrary server headers.
"""

import argparse
import concurrent.futures
import json
import statistics
import time
import urllib.error
import urllib.request
import uuid


def observe(base, path, expected, *, sha=None, method="GET"):
    request = urllib.request.Request(base.rstrip("/") + path, headers={
        "User-Agent": "Mozilla/5.0 KovaResidentAcceptance/1.0",
        "Cache-Control": "no-cache",
        "Cookie": "access_token=synthetic-invalid-resident-probe",
        "Content-Type": "application/json",
    }, data=b"{}" if method == "POST" else None, method=method)
    start = time.monotonic()
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        if response.status != expected:
            raise RuntimeError(f"Resident contract failed: {path} HTTP {response.status}")
        if response.headers.get("X-Kova-Runtime") != "native-resident":
            raise RuntimeError("Resident runtime marker missing")
        identity = response.headers.get("X-Kova-Process-Id", "")
        try:
            uuid.UUID(identity)
        except ValueError:
            raise RuntimeError("Resident process identity missing") from None
        if sha and path.endswith("health"):
            health = json.load(response)
            if health.get("status") != "ok" or health.get("release_sha") != sha:
                raise RuntimeError("Resident release identity mismatch")
        if path == "/api/v1/auth/session" and json.load(response).get("authenticated") is not False:
            raise RuntimeError("Anonymous session contract failed")
        return identity, (time.monotonic() - start) * 1000


def verify(base, *, sha=None, prefix="", idle_seconds=0, max_ms=3000, check_private_bindings=False):
    paths = [(prefix + "/health", 200), (prefix + "/health/db", 200),
             ("/api/v1/auth/session", 200), ("/api/v1/catalog/products", 401),
             ("/api/v1/reports/dashboard", 401), ("/api/v1/purchasing/orders", 401)]
    # Initial readiness is checked before the latency sample. Publication may
    # start a new process; this test measures reuse of that ready process.
    identity, _ = observe(base, paths[0][0], 200, sha=sha)
    if idle_seconds:
        # This standalone CI tool is bounded to one short inactivity interval.
        time.sleep(idle_seconds)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda item: observe(base, *item, sha=sha), paths * 4))
    if check_private_bindings:
        # Invalid request body cannot enter the login service or create an
        # account/session/email. A 422 proves the durable auth limiter allowed
        # validation; a broken private bridge would fail closed with 429.
        results.append(observe(base, "/api/v1/auth/login", 422, method="POST"))
    if any(value[0] != identity for value in results):
        raise RuntimeError("Resident process restarted during acceptance")
    times = [value[1] for value in results]
    if max(times) >= max_ms:
        raise RuntimeError(
            f"Resident latency exceeded {max_ms}ms budget: "
            f"median={round(statistics.median(times))}ms max={round(max(times))}ms"
        )
    result = {"contracts": len(times), "same_process": True,
              "idle_seconds": idle_seconds, "median_ms": round(statistics.median(times)),
              "max_ms": round(max(times))}
    print(json.dumps(result))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--sha")
    parser.add_argument("--prefix", default="")
    parser.add_argument("--idle-seconds", type=int, default=0)
    parser.add_argument("--max-ms", type=int, default=3000)
    parser.add_argument("--check-private-bindings", action="store_true")
    args = parser.parse_args()
    verify(args.base, sha=args.sha, prefix=args.prefix,
           idle_seconds=args.idle_seconds, max_ms=args.max_ms,
           check_private_bindings=args.check_private_bindings)
