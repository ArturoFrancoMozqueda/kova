"""Host-side CI-only synthetic photos; never imports the application in the API container."""

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from PIL import Image, ImageDraw
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


class VerificationError(RuntimeError):
    """Fixed diagnostics without database URLs or HTTP bodies."""


def require_local_ci(database_url=None):
    if os.environ.get("APP_ENV") != "ci" or os.environ.get("CI") != "true":
        raise VerificationError("Synthetic photo acceptance requires APP_ENV=ci and CI=true")
    if database_url is None:
        return
    try:
        url = make_url(database_url)
        valid = (
            url.drivername == "postgresql+psycopg"
            and url.host in {"localhost", "127.0.0.1"}
            and bool(url.database)
            and not url.query
        )
    except Exception:
        valid = False
    if not valid:
        raise VerificationError("Synthetic seed requires a local PostgreSQL CI database")


def synthetic_photos():
    jpeg = Image.effect_noise((2400, 1800), 15).convert("RGB")
    exif = Image.Exif()
    exif[274] = 6
    encoded = io.BytesIO()
    jpeg.save(encoded, "JPEG", quality=45, exif=exif)
    jpeg.close()
    rgba = Image.new("RGBA", (3200, 2500), (20, 100, 220, 255))
    ImageDraw.Draw(rgba).rectangle((0, 0, 1599, 2499), fill=(20, 100, 220, 0))
    png = io.BytesIO()
    rgba.save(png, "PNG")
    rgba.close()
    photos = [
        {"kind": "jpeg-exif", "mime": "image/jpeg", "data": encoded.getvalue(),
         "visualWidth": 1800, "visualHeight": 2400, "alpha": False},
        {"kind": "png-rgba-8mp", "mime": "image/png", "data": png.getvalue(),
         "visualWidth": 3200, "visualHeight": 2500, "alpha": True},
    ]
    if any(not 0 < len(photo["data"]) < 1024 * 1024 for photo in photos):
        raise VerificationError("Synthetic source exceeds the photo upload size contract")
    return photos


def seed(manifest_path):
    database_url = os.environ.get("DATABASE_URL", "")
    require_local_ci(database_url)
    # Models only: app.db/settings/main are deliberately never imported.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from app.catalog.models import Product, ProductImageFile
    from app.tenants.models import Tenant

    photos = synthetic_photos()
    tenant = uuid4()
    manifest = {"version": 1, "photos": []}
    engine = create_engine(database_url, hide_parameters=True)
    try:
        with engine.begin() as conn:
            conn.execute(Tenant.__table__.insert().values(
                id=tenant, name="CI native photo resources", slug=f"ci-photo-{tenant}",
            ))
            for photo in photos:
                product = uuid4()
                path = f"/api/v1/catalog/products/{product}/image?v=1"
                conn.execute(Product.__table__.insert().values(
                    id=product, tenant_id=tenant, name=f"CI {photo['kind']}",
                    price_amount=1, image_url=path,
                ))
                conn.execute(ProductImageFile.__table__.insert().values(
                    tenant_id=tenant, product_id=product, content_type=photo["mime"],
                    bytes_data=photo["data"], byte_size=len(photo["data"]),
                ))
                manifest["photos"].append({
                    key: value for key, value in {**photo, "path": path}.items()
                    if key not in {"data", "mime"}
                })
    except Exception:
        raise VerificationError("Local synthetic photo seed failed") from None
    finally:
        engine.dispose()
    Path(manifest_path).write_text(json.dumps(manifest), encoding="utf-8")
    return {"seeded": len(photos), "sourceBytes": [len(p["data"]) for p in photos]}


def load_manifest(manifest_path):
    try:
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        assert manifest["version"] == 1 and len(manifest["photos"]) == 2
        assert {p["kind"] for p in manifest["photos"]} == {"jpeg-exif", "png-rgba-8mp"}
        for photo in manifest["photos"]:
            assert re.fullmatch(
                r"/api/v1/catalog/products/[0-9a-f-]{36}/image\?v=1", photo["path"],
            )
            expected = ((1800, 2400, False) if photo["kind"] == "jpeg-exif"
                        else (3200, 2500, True))
            assert (photo["visualWidth"], photo["visualHeight"], photo["alpha"]) == expected
        return manifest["photos"]
    except Exception:
        raise VerificationError("Invalid local photo acceptance manifest") from None


def load_baseline(baseline_path, photos):
    try:
        baseline = json.loads(Path(baseline_path).read_text(encoding="utf-8"))
        assert set(baseline) == {"version", "processId", "digests"}
        assert baseline["version"] == 1
        assert re.fullmatch(r"[0-9a-f]{32}", baseline["processId"])
        expected = {f"{photo['kind']}:{width}" for photo in photos for width in (400, 160)}
        assert set(baseline["digests"]) == expected
        assert all(re.fullmatch(r"[0-9a-f]{64}", value)
                   for value in baseline["digests"].values())
        return baseline
    except Exception:
        raise VerificationError("Invalid local photo acceptance baseline") from None


def zero_resize_timing(value):
    matches = [part.strip() for part in value.split(",")
               if part.strip().split(";", 1)[0] == "image-resize"]
    return len(matches) == 1 and bool(re.fullmatch(r"image-resize;dur=0(?:\.0+)?", matches[0]))


def server_timings(value):
    """Return bounded numeric durations only; never retain arbitrary header text."""
    names = {"image-db", "image-cache", "image-resize"}
    if not isinstance(value, str) or not value or len(value) > 2048:
        return None
    result = dict.fromkeys(sorted(names))
    seen = set()
    for part in value.split(","):
        part = part.strip()
        name = part.split(";", 1)[0]
        if name not in names:
            continue
        if name in seen:
            result[name] = None
            continue
        seen.add(name)
        match = re.fullmatch(
            r"(?:image-db|image-cache|image-resize);dur=([0-9]{1,7}(?:\.[0-9]{1,6})?)", part,
        )
        if match is not None:
            duration = float(match[1])
            if duration <= 3_600_000:
                result[name] = duration
    return result


def photo_failure(message, photo, width, attempt, elapsed, *, response=None):
    metadata = {"kind": photo["kind"], "width": width, "repeat": bool(attempt),
                "elapsed_ms": round(max(0, elapsed), 3),
                "status": response.status_code if response is not None else None,
                "server_timing_ms": server_timings(
                    response.headers.get("server-timing") if response is not None else None,
                )}
    return VerificationError(message + "; diagnostics=" + json.dumps(metadata, sort_keys=True))


def verify(manifest_path, *, base="http://127.0.0.1:8000", client=None, clock=time.monotonic,
           require_persisted=False, baseline_path=None):
    require_local_ci()
    parsed = urlsplit(base)
    if (
        parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}
        or parsed.username or parsed.password or parsed.path not in {"", "/"}
        or parsed.query or parsed.fragment
    ):
        raise VerificationError("Photo acceptance HTTP target must be local loopback")
    photos = load_manifest(manifest_path)
    if require_persisted and baseline_path is None:
        raise VerificationError("Persisted photo acceptance requires the initial baseline")
    baseline = load_baseline(baseline_path, photos) if require_persisted else None
    if client is None:
        with httpx.Client(timeout=3, trust_env=False, follow_redirects=False) as local:
            return verify(manifest_path, base=base, client=local, clock=clock,
                          require_persisted=require_persisted, baseline_path=baseline_path)
    process_id = None
    observed = []
    digests = {}
    for photo in photos:
        for width in (400, 160):
            digest = None
            for attempt in range(2):
                start = clock()
                try:
                    response = client.get(base.rstrip("/") + photo["path"] + f"&w={width}")
                except Exception:
                    raise photo_failure(
                        "Local photo request failed or exceeded 3000ms", photo, width,
                        attempt, (clock() - start) * 1000,
                    ) from None
                elapsed = (clock() - start) * 1000
                process = response.headers.get("x-kova-process-id", "")
                if (
                    response.status_code != 200
                    or response.headers.get("content-type", "").split(";")[0] != "image/webp"
                    or response.headers.get("x-kova-runtime") != "native-resident"
                    or not re.fullmatch(r"[0-9a-f]{32}", process)
                    or (process_id is not None and process != process_id)
                    or elapsed > 3000
                ):
                    raise photo_failure(
                        "Photo response failed resident/MIME/status/3000ms contract",
                        photo, width, attempt, elapsed, response=response,
                    )
                if require_persisted and (
                    process == baseline["processId"]
                    or not zero_resize_timing(response.headers.get("server-timing", ""))
                ):
                    raise VerificationError(
                        "Persisted photo requires a new process and zero resize",
                    )
                process_id = process
                try:
                    with Image.open(io.BytesIO(response.content)) as img:
                        assert img.format == "WEBP"
                        assert img.size == (
                            width, int(photo["visualHeight"] * width / photo["visualWidth"]),
                        )
                        if photo["alpha"]:
                            assert "A" in img.getbands()
                            assert img.getchannel("A").getextrema() == (0, 255)
                        assert not img.getexif().get(274)
                except Exception:
                    raise VerificationError(
                        "Photo dimensions/orientation/transparency failed",
                    ) from None
                current = hashlib.sha256(response.content).hexdigest()
                variant_key = f"{photo['kind']}:{width}"
                if require_persisted and current != baseline["digests"][variant_key]:
                    raise VerificationError("Persisted photo bytes differ from initial baseline")
                if digest is not None and current != digest:
                    raise VerificationError("Repeated photo response changed bytes")
                digest = current
                digests[variant_key] = current
                observed.append({"kind": photo["kind"], "width": width,
                                 "repeat": bool(attempt), "ms": round(elapsed, 1),
                                 "bytes": len(response.content),
                                 "serverTimingMs": server_timings(
                                     response.headers.get("server-timing"),
                                 )})
    if baseline_path is not None and not require_persisted:
        Path(baseline_path).write_text(json.dumps({
            "version": 1, "processId": process_id, "digests": digests,
        }), encoding="utf-8")
    result = {"requests": observed, "sameProcess": True, "budgetMs": 3000}
    if require_persisted:
        result.update({"newProcess": True, "persistedVariants": 4, "zeroResize": True})
    return result


def persisted_rows_match(rows, photos, baseline):
    try:
        by_product = {str(row["product_id"]): row for row in rows}
        for photo in photos:
            product_id = photo["path"].split("/")[-2]
            row = by_product[product_id]
            fingerprint = bytes(row["source_digest"])
            assert len(fingerprint) == 32
            mime = "image/jpeg" if photo["kind"] == "jpeg-exif" else "image/png"
            assert row["source_mime"] == mime
            for width in (400, 160):
                entry = row[f"w{width}"]
                assert set(entry) == {
                    "source_sha256", "source_content_type", "content_type", "body_base64",
                }
                assert entry["source_sha256"] == fingerprint.hex()
                assert entry["source_content_type"] == mime
                assert entry["content_type"] == "image/webp"
                assert isinstance(entry["body_base64"], str)
                assert len(entry["body_base64"]) <= 4 * ((128 * 1024 + 2) // 3)
                body = base64.b64decode(entry["body_base64"], validate=True)
                assert 0 < len(body) <= 128 * 1024
                expected_digest = baseline["digests"][f"{photo['kind']}:{width}"]
                assert hashlib.sha256(body).hexdigest() == expected_digest
        return True
    except Exception:
        return False


def wait_persisted(manifest_path, baseline_path, *, clock=time.monotonic, sleep=time.sleep):
    database_url = os.environ.get("DATABASE_URL", "")
    require_local_ci(database_url)
    photos = load_manifest(manifest_path)
    baseline = load_baseline(baseline_path, photos)
    engine = create_engine(database_url, hide_parameters=True, connect_args={"connect_timeout": 2})
    deadline = clock() + 15
    try:
        while True:
            with engine.connect() as connection:
                connection.execute(text("SET TRANSACTION READ ONLY"))
                connection.execute(text("SET LOCAL statement_timeout = '1000ms'"))
                rows = connection.execute(text(
                    "SELECT i.product_id, pg_catalog.sha256(i.bytes_data) AS source_digest, "
                    "i.content_type AS source_mime, i.thumbnail_variants->'400' AS w400, "
                    "i.thumbnail_variants->'160' AS w160 FROM product_image_files i "
                    "JOIN products p ON p.id=i.product_id AND p.tenant_id=i.tenant_id "
                    "WHERE p.is_active IS TRUE AND i.product_id IN "
                    "(CAST(:first AS uuid),CAST(:second AS uuid))",
                ), {"first": photos[0]["path"].split("/")[-2],
                    "second": photos[1]["path"].split("/")[-2]}).mappings().all()
            if clock() >= deadline:
                raise VerificationError("Persisted photo variants were not ready within 15000ms")
            if persisted_rows_match(rows, photos, baseline):
                return {"persistedVariants": 4, "budgetMs": 15000}
            sleep(0.1)
    except VerificationError:
        raise
    except Exception:
        raise VerificationError("Local persisted photo verification failed") from None
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("seed", "verify", "wait-persisted"))
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--baseline")
    parser.add_argument("--require-persisted", action="store_true")
    args = parser.parse_args()
    if args.require_persisted and args.command != "verify":
        parser.error("--require-persisted is only valid for verify")
    if args.command == "wait-persisted" and args.baseline is None:
        parser.error("wait-persisted requires --baseline")
    try:
        if args.command == "seed":
            result = seed(args.manifest)
        elif args.command == "wait-persisted":
            result = wait_persisted(args.manifest, args.baseline)
        else:
            result = verify(args.manifest, base=args.base, baseline_path=args.baseline,
                            require_persisted=args.require_persisted)
    except VerificationError as exc:
        raise SystemExit(str(exc)) from None
    print(json.dumps(result))  # noqa: T201


if __name__ == "__main__":
    main()
