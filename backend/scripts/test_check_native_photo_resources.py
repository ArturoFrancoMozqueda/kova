"""Pure host tests: no application import, database, container or external network."""

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
from check_native_photo_resources import (
    VerificationError,
    load_manifest,
    require_local_ci,
    seed,
    synthetic_photos,
    verify,
)
from PIL import Image, ImageDraw


class PhotoResourcesTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"APP_ENV": "ci", "CI": "true"}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "photos.json"
        self.photos = [
            {"kind": "jpeg-exif", "visualWidth": 1800, "visualHeight": 2400, "alpha": False},
            {"kind": "png-rgba-8mp", "visualWidth": 3200, "visualHeight": 2500, "alpha": True},
        ]
        for photo in self.photos:
            photo["path"] = f"/api/v1/catalog/products/{uuid4()}/image?v=1"
        self.path.write_text(json.dumps({"version": 1, "photos": self.photos}))
        self.calls = 0

    def response(self, request, *, process="a" * 32, mime="image/webp", alpha=True):
        self.calls += 1
        photo = next(p for p in self.photos if request.url.path in p["path"])
        width = int(request.url.params["w"])
        size = (width, int(photo["visualHeight"] * width / photo["visualWidth"]))
        mode = "RGBA" if photo["alpha"] and alpha else "RGB"
        img = Image.new(mode, size, (20, 100, 200, 255) if mode == "RGBA" else (20, 100, 200))
        if mode == "RGBA":
            ImageDraw.Draw(img).rectangle((0, 0, width // 2, size[1]), fill=(20, 100, 200, 0))
        data = io.BytesIO()
        img.save(data, "WEBP")
        return httpx.Response(200, content=data.getvalue(), headers={
            "content-type": mime, "x-kova-runtime": "native-resident",
            "x-kova-process-id": process,
        })

    def run_verify(self, handler=None, **kwargs):
        with httpx.Client(transport=httpx.MockTransport(handler or self.response)) as client:
            return verify(self.path, client=client, **kwargs)

    def test_success_checks_both_sizes_cold_and_repeat(self):
        result = self.run_verify()
        self.assertEqual(self.calls, 8)
        self.assertTrue(result["sameProcess"])
        self.assertEqual(result["budgetMs"], 3000)
        self.assertEqual([p["width"] for p in result["requests"]], [400, 400, 160, 160] * 2)

    def test_seed_guards_before_database_or_application_imports(self):
        for app_env, ci in [("production", "true"), ("ci", "false"), ("ci", "")]:
            with self.subTest(app_env=app_env, ci=ci), patch.dict(
                os.environ, {"APP_ENV": app_env, "CI": ci}, clear=True,
            ), patch("check_native_photo_resources.create_engine") as engine:
                with self.assertRaises(VerificationError):
                    seed(self.path)
                engine.assert_not_called()

    def test_database_rejects_remote_and_host_overrides(self):
        for url in [
            "postgresql+psycopg://test@production.invalid/test",
            "postgresql+psycopg://test@localhost/test?host=remote.invalid",
            "postgresql+psycopg://test@127.0.0.1/test?service=production",
            "sqlite:///test.db", "", "not a url",
        ]:
            with self.subTest(url=url), self.assertRaises(VerificationError):
                require_local_ci(url)
        require_local_ci("postgresql+psycopg://test@localhost:5432/test")

    def test_sources_cover_phone_exif_and_eight_megapixel_transparency(self):
        photos = synthetic_photos()
        for photo in photos:
            self.assertLess(len(photo["data"]), 1024 * 1024)
            with Image.open(io.BytesIO(photo["data"])) as img:
                if photo["kind"] == "jpeg-exif":
                    self.assertEqual(img.size, (2400, 1800))
                    self.assertEqual(img.getexif()[274], 6)
                else:
                    self.assertEqual(img.width * img.height, 8_000_000)
                    self.assertEqual(img.getchannel("A").getextrema(), (0, 255))

    def test_verification_refuses_remote_http_before_any_request(self):
        for base in ["https://production.invalid", "http://localhost@remote.invalid",
                     "http://127.0.0.1/path", "http://localhost?target=remote"]:
            with self.subTest(base=base), self.assertRaises(VerificationError):
                self.run_verify(base=base)
        self.assertEqual(self.calls, 0)

    def test_manifest_cannot_escape_public_photo_path(self):
        self.photos[0]["path"] = "//remote.invalid/api/v1/catalog/products/x/image?v=1"
        self.path.write_text(json.dumps({"version": 1, "photos": self.photos}))
        with self.assertRaises(VerificationError):
            load_manifest(self.path)

    def test_process_restart_is_rejected(self):
        def restart(request):
            return self.response(request, process=("a" if self.calls == 0 else "b") * 32)
        with self.assertRaisesRegex(VerificationError, "resident"):
            self.run_verify(restart)

    def test_original_jpeg_fallback_is_rejected(self):
        with self.assertRaisesRegex(VerificationError, "MIME"):
            self.run_verify(lambda request: self.response(request, mime="image/jpeg"))

    def test_transparency_loss_is_rejected(self):
        with self.assertRaisesRegex(VerificationError, "transparency"):
            self.run_verify(lambda request: self.response(request, alpha=False))

    def test_three_second_budget_cannot_be_relaxed(self):
        ticks = iter([0, 3.001])
        with self.assertRaisesRegex(VerificationError, "3000ms"):
            self.run_verify(clock=lambda: next(ticks))

    def test_repeat_must_have_identical_bytes(self):
        def changed(request):
            response = self.response(request)
            if self.calls == 2:
                response = httpx.Response(200, headers=response.headers,
                                          content=response.content + b"changed")
            return response
        with self.assertRaisesRegex(VerificationError, "changed bytes"):
            self.run_verify(changed)


if __name__ == "__main__":
    unittest.main()
