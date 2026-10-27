"""Pure host tests: no application import, database, container or external network."""

import base64
import hashlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import uuid4

import httpx
from check_native_photo_resources import (
    VerificationError,
    load_manifest,
    persisted_rows_match,
    require_local_ci,
    seed,
    server_timings,
    synthetic_photos,
    verify,
    wait_persisted,
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

    def response(self, request, *, process="a" * 32, mime="image/webp", alpha=True, timing=None):
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
        headers = {
            "content-type": mime, "x-kova-runtime": "native-resident",
            "x-kova-process-id": process,
        }
        if timing is not None:
            headers["server-timing"] = timing
        return httpx.Response(200, content=data.getvalue(), headers=headers)

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

    def test_success_records_only_whitelisted_numeric_server_timings(self):
        result = self.run_verify(lambda request: self.response(
            request, timing='image-db;dur=1.250, image-cache;dur=0, image-resize;dur=2200.125, '
                            'secret-account;desc="never expose this";dur=7',
        ))
        for row in result["requests"]:
            self.assertEqual(row["serverTimingMs"],
                             {"image-db": 1.25, "image-cache": 0.0, "image-resize": 2200.125})
        self.assertNotIn("never expose", json.dumps(result))
        self.assertIsNone(self.run_verify()["requests"][0]["serverTimingMs"])

    def test_contract_failure_preserves_budget_and_safe_phase_diagnostics(self):
        ticks = iter([0, 3.001])
        with self.assertRaises(VerificationError) as caught:
            self.run_verify(lambda request: self.response(
                request, timing='image-db;dur=1.050, image-resize;dur=2997.85, '
                                'secret;desc="never expose"',
            ), clock=lambda: next(ticks))
        message, raw = str(caught.exception).split("; diagnostics=", 1)
        self.assertEqual(message, "Photo response failed resident/MIME/status/3000ms contract")
        self.assertEqual(json.loads(raw), {
            "kind": "jpeg-exif", "width": 400, "repeat": False,
            "elapsed_ms": 3001.0, "status": 200,
            "server_timing_ms": {"image-db": 1.05, "image-cache": None, "image-resize": 2997.85},
        })
        self.assertNotIn("never expose", raw)
        self.assertNotIn(self.photos[0]["path"], raw)

    def test_transport_failure_has_fixed_message_without_exception_or_response_payload(self):
        def unavailable(request):
            raise httpx.ReadTimeout("secret token and private body", request=request)
        ticks = iter([0, 3.001])
        with self.assertRaises(VerificationError) as caught:
            self.run_verify(unavailable, clock=lambda: next(ticks))
        message, raw = str(caught.exception).split("; diagnostics=", 1)
        self.assertEqual(message, "Local photo request failed or exceeded 3000ms")
        self.assertEqual(json.loads(raw), {
            "kind": "jpeg-exif", "width": 400, "repeat": False,
            "elapsed_ms": 3001.0, "status": None, "server_timing_ms": None,
        })
        self.assertNotIn("secret", str(caught.exception))
        self.assertNotIn(self.photos[0]["path"], raw)

    def test_timing_diagnostics_reject_ambiguous_non_numeric_or_oversized_values(self):
        self.assertIsNone(server_timings(None))
        self.assertIsNone(server_timings("x" * 2049))
        for value in ("NaN", "Infinity", "-1", "1e3", "+1", "1.2.3", "3600001",
                      '1;desc="secret token"', "000000000000001"):
            with self.subTest(value=value):
                parsed = server_timings("image-resize;dur=" + value)
                self.assertEqual(parsed, {"image-db": None, "image-cache": None,
                                          "image-resize": None})
                self.assertNotIn("secret", json.dumps(parsed))
        self.assertIsNone(server_timings("image-resize;dur=1, image-resize;dur=2")["image-resize"])

    def test_repeat_must_have_identical_bytes(self):
        def changed(request):
            response = self.response(request)
            if self.calls == 2:
                response = httpx.Response(200, headers=response.headers,
                                          content=response.content + b"changed")
            return response
        with self.assertRaisesRegex(VerificationError, "changed bytes"):
            self.run_verify(changed)

    def baseline(self):
        path = Path(self.directory.name) / "baseline.json"
        self.run_verify(baseline_path=path)
        return path

    def persisted_response(self, request):
        return self.response(request, process="b" * 32,
                             timing="image-db;dur=1.050, image-resize;dur=0.000")

    def test_restart_requires_persisted_bytes_zero_resize_and_changed_process(self):
        baseline = self.baseline()
        result = self.run_verify(self.persisted_response, require_persisted=True,
                                 baseline_path=baseline)
        self.assertEqual(self.calls, 16)
        self.assertTrue(result["newProcess"])
        self.assertTrue(result["zeroResize"])
        self.assertEqual(result["persistedVariants"], 4)
        self.assertEqual(result["budgetMs"], 3000)
        data = json.loads(baseline.read_text())
        self.assertEqual(set(data), {"version", "processId", "digests"})
        self.assertEqual(len(data["digests"]), 4)

    def test_persisted_rejects_same_process_missing_nonzero_or_duplicate_resize(self):
        baseline = self.baseline()
        for process, timing in [
            ("a" * 32, "image-resize;dur=0.000"), ("b" * 32, None),
            ("b" * 32, "image-resize;dur=0.001"),
            ("b" * 32, "image-resize;dur=0, image-resize;dur=0"),
        ]:
            with self.subTest(process=process, timing=timing), self.assertRaisesRegex(
                VerificationError, "new process and zero resize",
            ):
                self.run_verify(
                    lambda req, p=process, t=timing: self.response(req, process=p, timing=t),
                    require_persisted=True, baseline_path=baseline,
                )

    def test_persisted_rejects_changed_derived_bytes_after_restart(self):
        baseline = self.baseline()
        data = json.loads(baseline.read_text())
        data["digests"]["jpeg-exif:400"] = "0" * 64
        baseline.write_text(json.dumps(data))
        with self.assertRaisesRegex(VerificationError, "initial baseline"):
            self.run_verify(self.persisted_response, require_persisted=True, baseline_path=baseline)

    def test_persisted_rejects_absent_or_invalid_baseline_before_any_http(self):
        for path in [None, Path(self.directory.name) / "absent.json", self.path]:
            with self.subTest(path=path), self.assertRaises(VerificationError):
                self.run_verify(require_persisted=True, baseline_path=path)
        self.assertEqual(self.calls, 0)

    def test_persisted_keeps_three_second_budget(self):
        baseline = self.baseline()
        ticks = iter([0, 3.001])
        with self.assertRaisesRegex(VerificationError, "3000ms"):
            self.run_verify(self.persisted_response, require_persisted=True,
                            baseline_path=baseline, clock=lambda: next(ticks))

    def persisted_rows(self):
        baseline_path = self.baseline()
        baseline = json.loads(baseline_path.read_text())
        rows = []
        for photo in self.photos:
            row = {"product_id": photo["path"].split("/")[-2], "source_digest": b"a" * 32,
                   "source_mime": "image/jpeg" if photo["kind"] == "jpeg-exif" else "image/png"}
            for width in (400, 160):
                request = httpx.Request("GET", "http://localhost" + photo["path"] + f"&w={width}")
                body = self.response(request).content
                row[f"w{width}"] = {
                    "source_sha256": (b"a" * 32).hex(), "source_content_type": row["source_mime"],
                    "content_type": "image/webp", "body_base64": base64.b64encode(body).decode(),
                }
                self.assertEqual(hashlib.sha256(body).hexdigest(),
                                 baseline["digests"][f"{photo['kind']}:{width}"])
            rows.append(row)
        return rows, baseline_path, baseline

    def test_persisted_rows_require_source_sha_mime_body_width_and_all_four_slots(self):
        rows, _path, baseline = self.persisted_rows()
        self.assertTrue(persisted_rows_match(rows, self.photos, baseline))
        for field, value in [
            ("source_sha256", "0" * 64), ("source_content_type", "image/webp"),
            ("content_type", "image/png"), ("body_base64", "!invalid!"),
            ("body_base64", base64.b64encode(b"a" * (128 * 1024 + 1)).decode()),
        ]:
            original = rows[0]["w400"][field]
            rows[0]["w400"][field] = value
            self.assertFalse(persisted_rows_match(rows, self.photos, baseline))
            rows[0]["w400"][field] = original
        rows[0]["w160"] = rows[0]["w400"]
        self.assertFalse(persisted_rows_match(rows, self.photos, baseline))
        self.assertFalse(persisted_rows_match(rows[:1], self.photos, baseline))

    def test_wait_persisted_is_read_only_bounded_and_disposes_engine(self):
        rows, baseline_path, _baseline = self.persisted_rows()
        engine = MagicMock()
        connection = engine.connect.return_value.__enter__.return_value
        result = MagicMock()
        result.mappings.return_value.all.side_effect = [[], rows]
        connection.execute.return_value = result
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql+psycopg://pos@localhost/pos"}), \
                patch("check_native_photo_resources.create_engine", return_value=engine), \
                patch("check_native_photo_resources.time.sleep") as sleep:
            value = wait_persisted(self.path, baseline_path, clock=lambda: 0, sleep=sleep)
        self.assertEqual(value["persistedVariants"], 4)
        self.assertEqual(value["budgetMs"], 15000)
        statements = [str(call.args[0]) for call in connection.execute.call_args_list]
        self.assertEqual(statements[:2], [
            "SET TRANSACTION READ ONLY", "SET LOCAL statement_timeout = '1000ms'",
        ])
        self.assertTrue(statements[2].startswith("SELECT "))
        self.assertIn("pg_catalog.sha256(i.bytes_data)", statements[2])
        self.assertNotIn("SELECT i.bytes_data", statements[2])
        sleep.assert_called_once_with(0.1)
        engine.dispose.assert_called_once()

    def test_wait_persisted_timeout_cannot_pass_or_expose_database_errors(self):
        baseline = self.baseline()
        engine = MagicMock()
        connection = engine.connect.return_value.__enter__.return_value
        connection.execute.return_value.mappings.return_value.all.return_value = []
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql+psycopg://pos@localhost/pos"}), \
                patch("check_native_photo_resources.create_engine", return_value=engine):
            ticks = iter([0, 15])
            with self.assertRaisesRegex(VerificationError, "15000ms"):
                wait_persisted(self.path, baseline, clock=lambda: next(ticks))
            connection.execute.side_effect = RuntimeError("sensitive database diagnostic")
            with self.assertRaisesRegex(
                VerificationError, "^Local persisted photo verification failed$",
            ):
                wait_persisted(self.path, baseline)
        self.assertEqual(engine.dispose.call_count, 2)

    def test_wait_persisted_blocks_remote_database_before_engine_creation(self):
        remote = {"DATABASE_URL": "postgresql+psycopg://pos@remote.invalid/pos"}
        with patch.dict(os.environ, remote), \
                patch("check_native_photo_resources.create_engine") as engine:
            with self.assertRaises(VerificationError):
                wait_persisted(self.path, None)
            engine.assert_not_called()


if __name__ == "__main__":
    unittest.main()
