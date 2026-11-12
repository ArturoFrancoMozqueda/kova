#!/usr/bin/env python3
"""Read-only resident API acceptance: contracts, identity and warm latency.

No account creation, sign-in, emails or business writes. Never log response
bodies, cookies, credentials or arbitrary server headers.
"""

import argparse
import concurrent.futures
import json
import re
import statistics
import time
import urllib.error
import urllib.request
import uuid


class PreviousResidentProcess(RuntimeError):
    """Only the exact captured previous process is still serving during propagation."""


def observe(base, path, expected, *, sha=None, method="GET", expected_process_id=None,
            previous_process_id=None, previous_sha=None, deadline=None):
    request = urllib.request.Request(base.rstrip("/") + path, headers={
        "User-Agent": "Mozilla/5.0 KovaResidentAcceptance/1.0",
        "Cache-Control": "no-cache",
        "X-Kova-Resident-Diagnostic": "1",
        "Cookie": "access_token=synthetic-invalid-resident-probe",
        "Content-Type": "application/json",
    }, data=b"{}" if method == "POST" else None, method=method)
    start = time.monotonic()
    timeout = 15 if deadline is None else min(15, deadline - start)
    if timeout <= 0:
        raise RuntimeError("Resident publication convergence deadline exceeded")
    safe_method = method if method in {"GET", "POST"} else "UNKNOWN"
    endpoint = {
        ("GET", "/health"): "health",
        ("GET", "/api/health"): "health",
        ("GET", "/health/db"): "health_db",
        ("GET", "/api/health/db"): "health_db",
        ("GET", "/api/v1/auth/session"): "auth_session",
        ("GET", "/api/v1/catalog/products"): "catalog_products",
        ("GET", "/api/v1/reports/dashboard"): "reports_dashboard",
        ("GET", "/api/v1/purchasing/orders"): "purchasing_orders",
        ("POST", "/api/v1/auth/login"): "auth_login_validation",
    }.get((method, path), "unknown")
    try:
        try:
            response = urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            if response.status != expected:
                raise RuntimeError(
                    f"Resident contract failed: endpoint={endpoint} method={safe_method} HTTP {response.status}"
                ) from None
            if response.headers.get("X-Kova-Runtime") != "native-resident":
                raise RuntimeError("Resident runtime marker missing")
            identity = response.headers.get("X-Kova-Process-Id", "")
            try:
                uuid.UUID(identity)
            except ValueError:
                raise RuntimeError("Resident process identity missing") from None
            health = json.load(response) if sha and path.endswith("health") else None
            if (path == "/api/v1/auth/session"
                    and json.load(response).get("authenticated") is not False):
                raise RuntimeError("Anonymous session contract failed")
            if expected_process_id and identity != expected_process_id:
                if identity != previous_process_id:
                    raise RuntimeError("Unexpected resident process identity")
                if health is not None and (
                    health.get("status") != "ok" or health.get("release_sha") != previous_sha
                    or response.headers.get("X-Kova-Boot-Controller-Sha") != previous_sha
                    or response.headers.get("X-Kova-Controller-Sha") != previous_sha
                ):
                    raise RuntimeError("Resident previous release identity mismatch")
                if method != "GET":
                    raise RuntimeError("Resident validation probe reached the previous process")
                raise PreviousResidentProcess(
                    "Captured previous resident process still propagating"
                )
            if health is not None:
                if health.get("status") != "ok" or health.get("release_sha") != sha:
                    raise RuntimeError("Resident release identity mismatch")
            return identity, (time.monotonic() - start) * 1000
    except (TimeoutError, urllib.error.URLError) as error:
        category = "timeout" if (
            isinstance(error, TimeoutError)
            or isinstance(getattr(error, "reason", None), TimeoutError)
        ) else "url_transport"
        elapsed = max(0, round((time.monotonic() - start) * 1000))
        raise RuntimeError(
            f"Resident transport failed: endpoint={endpoint} method={safe_method} "
            f"elapsed_ms={elapsed} category={category}"
        ) from None


def _verify_once(base, *, sha=None, prefix="", idle_seconds=0, max_ms=3000,
                 check_private_bindings=False, expected_process_id=None,
                 previous_process_id=None, previous_sha=None, deadline=None):
    paths = [(prefix + "/health", 200), (prefix + "/health/db", 200),
             ("/api/v1/auth/session", 200), ("/api/v1/catalog/products", 401),
             ("/api/v1/reports/dashboard", 401), ("/api/v1/purchasing/orders", 401)]
    # Initial readiness is checked before the latency sample. Publication may
    # start a new process; this test measures reuse of that ready process.
    def sample(path, expected, **kwargs):
        return observe(base, path, expected, sha=sha, expected_process_id=expected_process_id,
                       previous_process_id=previous_process_id, previous_sha=previous_sha,
                       deadline=deadline, **kwargs)

    identity, _ = sample(paths[0][0], 200)
    if idle_seconds:
        # This standalone CI tool is bounded to one short inactivity interval.
        time.sleep(idle_seconds)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda item: sample(*item), paths * 4))
    if any(value[0] != identity for value in results):
        raise RuntimeError("Resident process restarted during acceptance")
    if check_private_bindings:
        # Invalid request body cannot enter the login service or create an
        # account/session/email. A 422 proves the durable auth limiter allowed
        # validation; a broken private bridge would fail closed with 429.
        results.append(sample("/api/v1/auth/login", 422, method="POST"))
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
    return result


def verify(base, *, sha=None, prefix="", idle_seconds=0, max_ms=3000,
           check_private_bindings=False, expected_process_id=None,
           previous_process_id=None, previous_sha=None):
    contextual = expected_process_id is not None
    if contextual and (
        not all(re.fullmatch(r"[a-f0-9]{32}", value or "")
                for value in (expected_process_id, previous_process_id))
        or expected_process_id == previous_process_id
        or not all(re.fullmatch(r"[a-f0-9]{40}", value or "") for value in (sha, previous_sha))
    ):
        raise RuntimeError("Resident convergence requires captured release and process identities")
    if not contextual and (previous_process_id is not None or previous_sha is not None):
        raise RuntimeError("Resident convergence requires its expected process identity")
    deadline = time.monotonic() + 60 if contextual else None
    for attempt in range(15 if contextual else 1):
        try:
            result = _verify_once(
                base, sha=sha, prefix=prefix, idle_seconds=idle_seconds, max_ms=max_ms,
                check_private_bindings=check_private_bindings,
                expected_process_id=expected_process_id, previous_process_id=previous_process_id,
                previous_sha=previous_sha, deadline=deadline,
            )
            if deadline is not None and time.monotonic() >= deadline:
                raise RuntimeError("Resident publication convergence deadline exceeded")
            print(json.dumps(result))
            return result
        except PreviousResidentProcess:
            if not contextual or attempt == 14 or time.monotonic() >= deadline:
                raise RuntimeError(
                    "Captured previous resident process did not finish propagating"
                ) from None
            # Restart the entire read-only sweep; never accept a mixed sample or
            # retry an unknown process, application error or transport failure.
            print(json.dumps({"event": "resident_previous_process_propagating"}))
            time.sleep(min(2, max(0, deadline - time.monotonic())))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--sha")
    parser.add_argument("--prefix", default="")
    parser.add_argument("--idle-seconds", type=int, default=0)
    parser.add_argument("--max-ms", type=int, default=3000)
    parser.add_argument("--check-private-bindings", action="store_true")
    parser.add_argument("--expected-process-id")
    parser.add_argument("--previous-process-id")
    parser.add_argument("--previous-sha")
    args = parser.parse_args()
    verify(args.base, sha=args.sha, prefix=args.prefix,
           idle_seconds=args.idle_seconds, max_ms=args.max_ms,
           check_private_bindings=args.check_private_bindings,
           expected_process_id=args.expected_process_id,
           previous_process_id=args.previous_process_id, previous_sha=args.previous_sha)
