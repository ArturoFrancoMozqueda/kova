import io
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from PIL import Image, PngImagePlugin, WebPImagePlugin

from app.catalog import image_router as images


def photo(*, size=(2400, 1800), color="red", mode="RGB", format="JPEG"):
    output = io.BytesIO()
    Image.new(mode, size, color).save(output, format=format)
    return output.getvalue()


def test_native_image_codecs_are_registered_before_first_photo_request():
    assert {"JPEG", "PNG", "WEBP"}.issubset(Image.OPEN)
    assert "WEBP" in Image.SAVE


@pytest.fixture(autouse=True)
def empty_thumbnail_cache():
    with images._image_cache_lock:
        images._resized_images.clear()
        images._resized_image_bytes = 0
    yield
    with images._image_cache_lock:
        images._resized_images.clear()
        images._resized_image_bytes = 0


def test_phone_photo_uses_reduced_decode_and_preserves_target_size(monkeypatch):
    source = photo()
    decoded = []
    original = Image.Image.resize

    def resize(image, *args, **kwargs):
        decoded.append(image.size)
        return original(image, *args, **kwargs)

    monkeypatch.setattr(Image.Image, "resize", resize)
    result, media_type = images._resize_to_width(source, "image/jpeg", 400)
    assert media_type == "image/webp"
    assert len(result) < len(source)
    with Image.open(io.BytesIO(result)) as thumbnail:
        assert thumbnail.size == (400, 300)
    assert decoded and all(w < 2400 and h < 1800 for w, h in decoded)


def test_transparent_photo_preserves_alpha():
    source = photo(size=(800, 600), color=(20, 40, 80, 0), mode="RGBA", format="PNG")
    result, media_type = images._resize_to_width(source, "image/png", 160)
    assert media_type == "image/webp"
    with Image.open(io.BytesIO(result)) as thumbnail:
        assert thumbnail.size == (160, 120)
        assert thumbnail.convert("RGBA").getpixel((0, 0))[3] == 0


def test_large_transparent_photo_prefilters_before_final_lanczos(monkeypatch):
    image = Image.new("RGBA", (3200, 2500), (20, 100, 220, 255))
    image.paste((20, 100, 220, 0), (0, 0, 1600, 2500))
    encoded = io.BytesIO()
    image.save(encoded, "PNG")
    image.close()
    intermediates = []
    original = Image.Image.reduce

    def counted(source, *args, **kwargs):
        reduced = original(source, *args, **kwargs)
        intermediates.append((reduced.size, reduced.mode))
        return reduced

    monkeypatch.setattr(Image.Image, "reduce", counted)
    result, media_type = images._resize_to_width(encoded.getvalue(), "image/png", 400)
    assert media_type == "image/webp"
    # Keep final LANCZOS work bounded while filtering premultiplied alpha,
    # rather than scanning the original 8 MP for the final resampling pass.
    assert intermediates and all(size[0] <= 800 and mode == "RGBa"
                                 for size, mode in intermediates)
    with Image.open(io.BytesIO(result)) as thumbnail:
        assert thumbnail.size == (400, 312)
        assert thumbnail.convert("RGBA").getpixel((10, 150))[3] == 0
        assert thumbnail.convert("RGBA").getpixel((390, 150))[3] == 255


def test_phone_orientation_is_applied_before_emitting_webp():
    source = Image.new("RGB", (1200, 800), "red")
    source.paste("blue", (0, 400, 1200, 800))
    exif = Image.Exif()
    exif[274] = 6
    encoded = io.BytesIO()
    source.save(encoded, format="JPEG", exif=exif)
    result, media_type = images._resize_to_width(encoded.getvalue(), "image/jpeg", 160)
    assert media_type == "image/webp"
    with Image.open(io.BytesIO(result)) as thumbnail:
        assert thumbnail.size == (160, 240)
        left = thumbnail.convert("RGB").getpixel((10, 120))
        right = thumbnail.convert("RGB").getpixel((150, 120))
        assert left[2] > left[0]
        assert right[0] > right[2]
        assert thumbnail.getexif().get(274, 1) == 1


def test_concurrent_repeated_photo_decodes_once_and_replacement_is_fresh(monkeypatch):
    source = photo()
    calls = []
    render = images._render_thumbnail

    def counted(*args):
        calls.append(args[2])
        return render(*args)

    monkeypatch.setattr(images, "_render_thumbnail", counted)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: images._resize_to_width(source, "image/jpeg", 320), range(8)))
    assert all(result == results[0] for result in results)
    assert calls == [320]
    replacement = images._resize_to_width(photo(color="blue"), "image/jpeg", 320)
    assert replacement != results[0]
    assert calls == [320, 320]


def test_thumbnail_cache_evicts_by_bytes_without_retaining_originals(monkeypatch):
    source = photo()
    thumbnail = images._resize_to_width(source, "image/jpeg", 160)
    with images._image_cache_lock:
        images._resized_images.clear()
        images._resized_image_bytes = 0
    monkeypatch.setattr(images, "_RESIZE_CACHE_BYTES", len(thumbnail[0]))
    images._resize_to_width(source, "image/jpeg", 160)
    images._resize_to_width(photo(color="blue"), "image/jpeg", 160)
    assert images._resized_image_bytes <= len(thumbnail[0])
    assert len(images._resized_images) <= 1
    assert all(source not in key for key in images._resized_images)


def test_oversized_decode_keeps_existing_original_fallback(monkeypatch):
    source = photo(size=(800, 600), mode="RGBA", color=(20, 40, 80, 255), format="PNG")
    monkeypatch.setattr(images, "_MAX_DECODED_PIXELS", 100)
    assert images._resize_to_width(source, "image/png", 160) == (source, "image/png")
    assert not images._resized_images


def test_oversized_png_never_loads_pixels_while_reading_exif(monkeypatch):
    source = photo(size=(800, 600), mode="RGBA", color=(20, 40, 80, 0), format="PNG")
    monkeypatch.setattr(images, "_MAX_DECODED_PIXELS", 100)
    loads = []
    original = PngImagePlugin.PngImageFile.load

    def counted(image, *args, **kwargs):
        loads.append(image.size)
        return original(image, *args, **kwargs)

    monkeypatch.setattr(PngImagePlugin.PngImageFile, "load", counted)
    assert images._resize_to_width(source, "image/png", 160) == (source, "image/png")
    assert loads == []


@pytest.mark.parametrize("chunk,mode,lossless", [
    (b"VP8 ", "RGB", False), (b"VP8L", "RGB", True), (b"VP8X", "RGBA", False),
])
def test_webp_canvas_is_bounded_before_decoder_allocation(monkeypatch, chunk, mode, lossless):
    encoded = io.BytesIO()
    image = Image.new(mode, (800, 600), (20, 40, 80, 0) if mode == "RGBA" else "red")
    image.save(encoded, "WEBP", lossless=lossless)
    source = encoded.getvalue()
    assert source[12:16] == chunk
    assert images._webp_canvas_size(source) == (800, 600)
    monkeypatch.setattr(images, "_MAX_DECODED_PIXELS", 100)
    decoders = []
    original = WebPImagePlugin._webp.WebPAnimDecoder

    def counted(*args):
        decoders.append(True)
        return original(*args)

    monkeypatch.setattr(WebPImagePlugin._webp, "WebPAnimDecoder", counted)
    assert images._resize_to_width(source, "image/webp", 160) == (source, "image/webp")
    assert decoders == []
    monkeypatch.setattr(images, "_MAX_DECODED_PIXELS", 800 * 600)
    result, media_type = images._resize_to_width(source, "image/webp", 160)
    assert media_type == "image/webp"
    assert decoders == [True]
    with Image.open(io.BytesIO(result)) as thumbnail:
        assert thumbnail.size == (160, 120)
        if mode == "RGBA":
            assert thumbnail.convert("RGBA").getpixel((0, 0))[3] == 0


def test_malformed_webp_headers_fall_back_without_constructing_decoder(monkeypatch):
    encoded = io.BytesIO()
    Image.new("RGB", (800, 600), "red").save(encoded, "WEBP", lossless=True)
    source = encoded.getvalue()
    assert source[12:16] == b"VP8L"
    opened = []
    original = Image.open

    def counted(*args, **kwargs):
        opened.append(True)
        return original(*args, **kwargs)

    monkeypatch.setattr(Image, "open", counted)
    malformed = [
        source[:12], source[:24],  # Missing/truncated chunk headers/payload.
        source[:4] + (len(source) + 100).to_bytes(4, "little") + source[8:],
        source[:16] + len(source).to_bytes(4, "little") + source[20:],
        source[:12] + b"JUNK" + source[16:],
        source[:20] + b"\x00" + source[21:],  # Lossless signature.
        source[:24] + bytes([source[24] | 0xE0]) + source[25:],  # Reserved version.
    ]
    for data in malformed:
        assert images._webp_canvas_size(data) is None
        assert images._resize_to_width(data, "image/webp", 160) == (data, "image/webp")
    assert opened == []


def test_large_jpeg_still_uses_draft_before_pixel_limit(monkeypatch):
    source = photo(size=(2400, 1800))
    monkeypatch.setattr(images, "_MAX_DECODED_PIXELS", 500_000)
    result, media_type = images._resize_to_width(source, "image/jpeg", 400)
    assert media_type == "image/webp"
    with Image.open(io.BytesIO(result)) as thumbnail:
        assert thumbnail.size == (400, 300)


def test_corrupt_and_small_images_preserve_original_bytes():
    assert images._resize_to_width(b"invalid", "image/jpeg", 160) == (b"invalid", "image/jpeg")
    source = photo(size=(80, 60))
    assert images._resize_to_width(source, "image/jpeg", 160) == (source, "image/jpeg")


def test_photo_replacements_in_same_second_get_distinct_version_urls():
    product_id = uuid4()
    now = datetime(2026, 10, 20, 12, 0, 0, 100, tzinfo=UTC)
    assert images._image_url(product_id, now) != images._image_url(product_id, now + timedelta(microseconds=1))


def test_image_admission_precedes_loading_original_blob():
    requested = Event()
    db = MagicMock()
    db.execute.side_effect = lambda _: (requested.set() or MagicMock(
        one_or_none=lambda: (photo(size=(10, 10)), "image/jpeg"),
    ))
    for _ in range(4):
        images._image_load_slots.acquire()
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            result = pool.submit(images.get_product_image, uuid4(), db, None)
            assert not requested.wait(0.05)
            images._image_load_slots.release()
            response = result.result(timeout=2)
            assert requested.is_set() and response.status_code == 200
    finally:
        for _ in range(3):
            images._image_load_slots.release()
