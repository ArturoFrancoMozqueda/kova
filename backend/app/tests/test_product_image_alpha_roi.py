"""Skipping transparent reduction blocks must match Pillow pixel for pixel."""

import io
from contextlib import closing

import pytest
from PIL import Image, ImageDraw

from app.catalog import image_router as images


def _source(size, bounds, alpha):
    # Nonzero hidden RGB proves that only alpha determines the skipped region.
    source = Image.new("RGBA", size, (249, 117, 59, 0))
    if bounds is not None:
        ImageDraw.Draw(source).rectangle(
            (bounds[0], bounds[1], bounds[2] - 1, bounds[3] - 1),
            fill=(37, 163, 239, alpha),
        )
    return source


@pytest.mark.parametrize("bounds,alpha", [
    (None, 0),
    ((0, 0, 1603, 1207), 255),  # Full alpha bounding box retains the original path.
    ((17, 23, 1501, 1109), 127),  # Both edges cut across reduction blocks.
    ((17, 23, 1501, 1109), 1),  # Premultiplication and averaging round small alpha.
    ((1, 3, 1603, 1206), 250),  # Partial blocks at odd physical image edges.
    ((0, 0, 1, 1), 127),
    ((1602, 1206, 1603, 1207), 255),
    ((801, 1, 802, 1207), 127),  # Narrow alpha regions still need whole blocks.
    ((1, 605, 1603, 606), 127),
])
@pytest.mark.parametrize("width", [160, 400, 800])
def test_alpha_roi_preserves_exact_pillow_pixels_and_webp(bounds, alpha, width):
    with closing(_source((1603, 1207), bounds, alpha)) as source:
        size = (width, int(source.height * width / source.width))
        with (closing(images._resize_rgba_in_stripes(source, size)) as actual,
              closing(source.resize(size, Image.Resampling.LANCZOS,
                                    reducing_gap=2.0)) as expected):
            assert actual.tobytes() == expected.tobytes()
            actual_webp, expected_webp = io.BytesIO(), io.BytesIO()
            actual.save(actual_webp, "WEBP", quality=82, method=4)
            expected.save(expected_webp, "WEBP", quality=82, method=4)
            assert actual_webp.getvalue() == expected_webp.getvalue()


@pytest.mark.parametrize("orientation", [1, 6])
@pytest.mark.parametrize("width", [160, 400])
def test_odd_large_roi_keeps_rotated_fractional_geometry(monkeypatch, orientation, width):
    with closing(_source((3199, 2499), (1557, 1003, 3198, 2499), 127)) as source:
        # Disconnected alpha and mixed opacity exercise the entire ROI grid.
        source.putpixel((13, 11), (241, 39, 93, 1))
        ImageDraw.Draw(source).rectangle((1901, 1401, 2403, 1907), fill=(89, 73, 29, 255))
        exif = Image.Exif()
        exif[274] = orientation
        encoded = io.BytesIO()
        source.save(encoded, "PNG", exif=exif)
    actual = images._render_thumbnail(encoded.getvalue(), "image/png", width)
    monkeypatch.setattr(images, "_resize_rgba_in_stripes", lambda image, size: image.resize(
        size, Image.Resampling.LANCZOS, reducing_gap=2.0,
    ))
    assert actual == images._render_thumbnail(encoded.getvalue(), "image/png", width)
    assert actual[1] == "image/webp"


def test_roi_reduces_only_nonzero_blocks_with_bounded_stripes(monkeypatch):
    boxes, paste_offsets = [], []
    crop, paste = Image.Image.crop, Image.Image.paste

    def record_crop(source, box=None):
        boxes.append(box)
        return crop(source, box)

    def record_paste(source, image, box=None, mask=None):
        if source.mode == "RGBa":
            paste_offsets.append(box)
        return paste(source, image, box, mask)

    monkeypatch.setattr(Image.Image, "crop", record_crop)
    monkeypatch.setattr(Image.Image, "paste", record_paste)
    # Exact native acceptance geometry; no smaller fixture or larger pixel cap.
    with closing(_source((3200, 2500), (1600, 0, 3200, 2500), 255)) as source:
        with closing(images._resize_rgba_in_stripes(source, (400, 312))) as result:
            assert result.size == (400, 312)
    assert sum((right - left) * (bottom - top)
               for left, top, right, bottom in boxes) == 4_000_000
    assert all((right - left) * (bottom - top) <= images._THUMBNAIL_STRIPE_PIXELS
               for left, top, right, bottom in boxes)
    assert all(left % 4 == top % 4 == 0 for left, top, _right, _bottom in boxes)
    assert paste_offsets == [(400, top // 4) for _left, top, _right, _bottom in boxes]


def test_empty_alpha_never_allocates_stripe_working_buffers(monkeypatch):
    with closing(_source((3200, 2500), None, 0)) as source:
        monkeypatch.setattr(source, "crop", lambda *_a: pytest.fail("transparent stripe"))
        with closing(images._resize_rgba_in_stripes(source, (400, 312))) as result:
            assert result.getbbox(alpha_only=False) is None
