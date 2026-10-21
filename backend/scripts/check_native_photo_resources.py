"""Host-side CI-only synthetic photos; never imports the application in the API container."""

import argparse
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
from sqlalchemy import create_engine
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


def verify(manifest_path, *, base="http://127.0.0.1:8000", client=None, clock=time.monotonic):
    require_local_ci()
    parsed = urlsplit(base)
    if (
        parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}
        or parsed.username or parsed.password or parsed.path not in {"", "/"}
        or parsed.query or parsed.fragment
    ):
        raise VerificationError("Photo acceptance HTTP target must be local loopback")
    photos = load_manifest(manifest_path)
    if client is None:
        with httpx.Client(timeout=3, trust_env=False, follow_redirects=False) as local:
            return verify(manifest_path, base=base, client=local, clock=clock)
    process_id = None
    observed = []
    for photo in photos:
        for width in (400, 160):
            digest = None
            for attempt in range(2):
                start = clock()
                try:
                    response = client.get(base.rstrip("/") + photo["path"] + f"&w={width}")
                except Exception:
                    raise VerificationError(
                        "Local photo request failed or exceeded 3000ms",
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
                    raise VerificationError(
                        "Photo response failed resident/MIME/status/3000ms contract",
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
                if digest is not None and current != digest:
                    raise VerificationError("Repeated photo response changed bytes")
                digest = current
                observed.append({"kind": photo["kind"], "width": width,
                                 "repeat": bool(attempt), "ms": round(elapsed, 1),
                                 "bytes": len(response.content)})
    return {"requests": observed, "sameProcess": True, "budgetMs": 3000}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("seed", "verify"))
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    try:
        result = seed(args.manifest) if args.command == "seed" else verify(
            args.manifest, base=args.base,
        )
    except VerificationError as exc:
        raise SystemExit(str(exc)) from None
    print(json.dumps(result))  # noqa: T201


if __name__ == "__main__":
    main()
