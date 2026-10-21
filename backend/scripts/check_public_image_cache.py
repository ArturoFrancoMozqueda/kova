"""CI-only, read-only production photo acceptance; never logs IDs or credentials.

Discover one existing public product photo with a read-only SQL transaction.
No account, photo or business record is created or changed. Exercise only its
public GET contract and anonymous/private cache boundaries on the fixed domains.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import UUID

import httpx
import psycopg
from provision_native_runtime import database_urls

ORIGINS = ("https://api.kovasuite.com", "https://kovasuite.com")


class VerificationError(RuntimeError):
    """Fixed diagnostics only; never wrap raw database/HTTP exceptions."""


def discover_photo(owner, *, connect=psycopg.connect):
    try:
        _, privileged = database_urls(owner, "unused-not-a-runtime-credential")
        dsn = privileged.set(drivername="postgresql").render_as_string(hide_password=False)
        with connect(dsn, connect_timeout=15, prepare_threshold=None) as conn:
            conn.execute("SET TRANSACTION READ ONLY")
            conn.execute("SET LOCAL statement_timeout = '5s'")
            row = conn.execute(
                "SELECT p.id, p.image_url FROM product_image_files i "
                "JOIN products p ON p.id = i.product_id AND p.tenant_id = i.tenant_id "
                "JOIN tenants t ON t.id = p.tenant_id "
                "WHERE p.is_active AND t.is_active AND p.image_url IS NOT NULL "
                "AND i.content_type IN ('image/jpeg', 'image/png', 'image/webp') "
                "ORDER BY i.byte_size DESC LIMIT 1"
            ).fetchone()
    except Exception:
        raise VerificationError("Read-only public photo discovery failed") from None
    if not row:
        raise VerificationError("No existing public photo is available; no data was created")
    try:
        product = UUID(str(row[0]))
        parsed = urlsplit(row[1])
        query = parse_qs(parsed.query, keep_blank_values=True)
        expected = f"/api/v1/catalog/products/{product}/image"
        if (
            parsed.scheme
            or parsed.netloc
            or parsed.fragment
            or parsed.path != expected
            or set(query) != {"v"}
            or len(query["v"]) != 1
            or not re.fullmatch(r"[0-9]{1,20}", query["v"][0])
        ):
            raise ValueError
        return expected + "?" + urlencode({"v": query["v"][0], "w": "160"})
    except Exception:
        raise VerificationError(
            "Existing photo URL does not match the public image contract"
        ) from None


def observe_photo(client, url):
    started = time.monotonic()
    response = client.get(url)
    elapsed = round((time.monotonic() - started) * 1000)
    control = response.headers.get("cache-control", "").lower()
    if (
        response.status_code != 200
        or "public" not in control
        or "no-store" in control
        or response.headers.get("set-cookie")
        or response.headers.get("content-type", "").split(";")[0]
        not in {
            "image/jpeg",
            "image/png",
            "image/webp",
        }
        or not 0 < len(response.content) <= 1024 * 1024
    ):
        raise VerificationError("Public photo status, cache policy or payload contract failed")
    marker = response.headers.get("x-kova-image-cache")
    if marker not in {"HIT", "MISS"}:
        raise VerificationError("Production public image cache marker is missing")
    return {"ms": elapsed, "bytes": len(response.content), "cache": marker}, hashlib.sha256(
        response.content
    ).digest()


def verify(client, path, sha):
    health = client.get(ORIGINS[0] + "/health")
    if (
        health.status_code != 200
        or health.headers.get("x-kova-runtime") != "native-resident"
        or health.json().get("release_sha") != sha
    ):
        raise VerificationError("Production resident release identity failed")
    results = []
    reference = None
    for origin in ORIGINS:
        first, digest = observe_photo(client, origin + path)
        if reference is not None and digest != reference:
            raise VerificationError("API and frontend photo payloads differ")
        reference = digest
        hit = None
        for _ in range(4):
            time.sleep(0.5)
            sample, repeated_digest = observe_photo(client, origin + path)
            if repeated_digest != digest:
                raise VerificationError("Photo changed during read-only acceptance")
            if sample["cache"] == "HIT":
                hit = sample
                break
        if hit is None or hit["ms"] >= 3000:
            raise VerificationError("Production photo cache did not serve a timely HIT")
        results.append({"origin": origin, "first": first, "repeat": hit})
        for private_path, status in [
            ("/api/v1/auth/session", 200),
            ("/api/v1/catalog/products", 401),
        ]:
            response = client.get(origin + private_path)
            if (
                response.status_code != status
                or "no-store" not in response.headers.get("cache-control", "")
                or response.headers.get("x-kova-image-cache") is not None
            ):
                raise VerificationError("Private API cache boundary failed")
            if (
                private_path.endswith("session")
                and response.json().get("authenticated") is not False
            ):
                raise VerificationError("Anonymous session boundary failed")
    return {
        "existing_photo_only": True,
        "same_image": True,
        "private_api_no_store": True,
        "samples": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-public-images", action="store_true")
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    try:
        if (
            not args.verify_public_images
            or os.environ.get("CI") != "true"
            or os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("GITHUB_REF") != "refs/heads/main"
            or not re.fullmatch(r"[a-f0-9]{40}", args.sha)
        ):
            raise VerificationError("Explicit production CI photo acceptance is required")
        path = discover_photo(os.environ.get("SUPABASE_DB_URL", ""))
        with httpx.Client(
            timeout=20,
            follow_redirects=False,
            trust_env=False,
            headers={"User-Agent": "Mozilla/5.0 KovaPublicPhotoAcceptance/1.0"},
        ) as client:
            print(json.dumps(verify(client, path, args.sha)))
    except VerificationError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        print(
            "Public photo acceptance failed; credentials and response bodies were not logged",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
