"""Bounded RGBA working memory must preserve Pillow's exact thumbnail bytes."""

import io

import pytest
from PIL import Image

from app.catalog import image_router as images


def _encoded_photo(mode, size, format, orientation):
    with Image.linear_gradient("L") as ramp:
        alpha = ramp.resize(size)
    try:
        if mode == "LA":
            source = Image.merge("LA", (alpha, alpha))
        elif mode == "P":
            source = alpha.convert("P")
        else:
            with (alpha.transpose(Image.Transpose.FLIP_LEFT_RIGHT) as green,
                  alpha.transpose(Image.Transpose.FLIP_TOP_BOTTOM) as blue):
                source = Image.merge("RGBA", (alpha, green, blue, alpha))
            if mode == "RGB":
                converted = source.convert("RGB")
                source.close()
                source = converted
        try:
            exif = Image.Exif()
            exif[274] = orientation
            options = {"exif": exif}
            if mode == "P":
                options["transparency"] = bytes(range(256))
            if format == "WEBP":
                options["lossless"] = True
            output = io.BytesIO()
            source.save(output, format, **options)
            return output.getvalue()
        finally:
            source.close()
    finally:
        alpha.close()


@pytest.mark.parametrize("mode,size,format,mime", [
    ("RGBA", (1603, 1207), "PNG", "image/png"),
    ("RGBA", (3201, 2499), "PNG", "image/png"),
    ("RGBA", (3199, 2499), "PNG", "image/png"),  # Integer factors 9x10 at width 160.
    ("LA", (1603, 1207), "PNG", "image/png"),
    ("P", (1603, 1207), "PNG", "image/png"),
    ("RGBA", (1603, 1207), "WEBP", "image/webp"),
    ("RGB", (1603, 1207), "JPEG", "image/jpeg"),
])
@pytest.mark.parametrize("width", sorted(images.ALLOWED_RESIZE_WIDTHS))
@pytest.mark.parametrize("orientation", [1, 6])
def test_striped_render_matches_exact_existing_pillow_bytes(
    monkeypatch, mode, size, format, mime, width, orientation,
):
    source = _encoded_photo(mode, size, format, orientation)
    actual = images._render_thumbnail(source, mime, width)
    with monkeypatch.context() as patch:
        patch.setattr(images, "_resize_rgba_in_stripes", lambda image, target: image.resize(
            target, Image.Resampling.LANCZOS, reducing_gap=2.0,
        ))
        expected = images._render_thumbnail(source, mime, width)
    assert actual[1] == "image/webp"
    assert actual == expected
    with Image.open(io.BytesIO(actual[0])) as result:
        assert result.width == width
        assert result.getexif().get(274, 1) == 1


def test_stripes_are_aligned_bounded_and_premultiplied(monkeypatch):
    tiles, reductions = [], []
    crop, reduce = Image.Image.crop, Image.Image.reduce

    def record_crop(image, box=None):
        tiles.append(box)
        return crop(image, box)

    def record_reduce(image, factor, box=None):
        reductions.append((image.mode, factor))
        return reduce(image, factor, box)

    monkeypatch.setattr(Image.Image, "crop", record_crop)
    monkeypatch.setattr(Image.Image, "reduce", record_reduce)
    # Keep the actual 8 MP boundary and transparent source, rather than making
    # the workload smaller to pass the native resource acceptance.
    with Image.new("RGBA", (3200, 2500), (20, 100, 220, 127)) as source:
        with images._resize_rgba_in_stripes(source, (400, 312)) as result:
            assert result.size == (400, 312)
    assert len(tiles) > 1
    assert all((right - left) * (bottom - top) <= images._THUMBNAIL_STRIPE_PIXELS
               and top % 4 == 0 for left, top, right, bottom in tiles)
    assert reductions == [("RGBa", (4, 4))] * len(tiles)


def test_extreme_aspect_falls_back_before_allocating_a_stripe_canvas(monkeypatch):
    with Image.new("RGBA", (1_000_001, 2), (20, 100, 220, 127)) as source:
        with source.resize((160, 1), Image.Resampling.LANCZOS, reducing_gap=2.0) as expected:
            expected_bytes = expected.tobytes()
        monkeypatch.setattr(images.Image, "new", lambda *_a, **_kw: pytest.fail("extra canvas"))
        monkeypatch.setattr(source, "crop", lambda *_a, **_kw: pytest.fail("extra stripe"))
        with images._resize_rgba_in_stripes(source, (160, 1)) as actual:
            assert actual.tobytes() == expected_bytes


def test_all_stripe_buffers_close_if_a_later_crop_fails(monkeypatch):
    allocated = []
    new, crop, convert, reduce = Image.new, Image.Image.crop, Image.Image.convert, Image.Image.reduce
    calls = 0

    def record_new(*args, **kwargs):
        image = new(*args, **kwargs)
        allocated.append(image)
        return image

    def record_crop(image, box=None):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("synthetic crop failure")
        result = crop(image, box)
        allocated.append(result)
        return result

    def record_convert(image, *args, **kwargs):
        result = convert(image, *args, **kwargs)
        allocated.append(result)
        return result

    def record_reduce(image, *args, **kwargs):
        result = reduce(image, *args, **kwargs)
        allocated.append(result)
        return result

    with new("RGBA", (3200, 2500), (20, 100, 220, 127)) as source:
        monkeypatch.setattr(Image, "new", record_new)
        monkeypatch.setattr(Image.Image, "crop", record_crop)
        monkeypatch.setattr(Image.Image, "convert", record_convert)
        monkeypatch.setattr(Image.Image, "reduce", record_reduce)
        with pytest.raises(RuntimeError, match="synthetic crop failure"):
            images._resize_rgba_in_stripes(source, (400, 312))
        assert source.getpixel((0, 0)) == (20, 100, 220, 127)
    assert len(allocated) == 4  # Composite, crop, premultiplied, reduced tile.
    for image in allocated:
        with pytest.raises(ValueError, match="closed image"):
            image.getim()
