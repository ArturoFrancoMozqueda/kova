"""Read-only boot checks for the resident native transport."""

import re
from uuid import uuid4


def validate_image_identity(image_sha: str | None, release_sha: str) -> None:
    if (
        not image_sha
        or not re.fullmatch(r"[a-fA-F0-9]{40}", image_sha)
        or image_sha != release_sha
    ):
        raise RuntimeError("Native API image does not match the deployed release")


def validate_boot_controller_identity(
    controller_sha: str | None, release_sha: str, *, allow_legacy_off_boot: bool = False,
) -> None:
    """Reject an SDK auto-start under another controller before opening HTTP.

    The legacy controller omits this marker during the initial OFF bootstrap.
    Once supplied, it must identify the exact immutable application release.
    This also covers a process replacement after the controller's readiness
    check but before the SDK forwards a write.
    """
    if controller_sha is None and allow_legacy_off_boot:
        return
    if (not isinstance(controller_sha, str)
            or not re.fullmatch(r"[a-fA-F0-9]{40}", controller_sha)
            or controller_sha != release_sha):
        raise RuntimeError("Native boot controller does not match the image release")


def validate_storage_transport() -> None:
    from app.assistant import storage

    # Storage is optional in the existing application. Retain its intentional
    # not-configured state; verify the real native S3 transport whenever ready.
    if not storage.ready():
        return
    try:
        # Fresh UUIDs are unrelated to any customer's tenant or document. HEAD
        # of an absent object is a valid authenticated read (404), not a write.
        storage.exists(uuid4(), uuid4())
    except Exception:
        # Keep credentials, endpoints and provider payloads out of boot errors.
        raise RuntimeError("Native private storage transport is not ready") from None


def prepare_native_routes(application) -> None:
    """Materialize every included route before the resident listener opens.

    FastAPI 0.141 preserves included routers and builds their effective
    dependency/response graphs lazily. A small always-on CPU must not perform
    that work during a customer's first visit to a product area. The public
    OpenAPI generator walks all included routes without invoking endpoints or
    dependencies. Production docs remain disabled by the existing app config.
    """
    application.openapi()
