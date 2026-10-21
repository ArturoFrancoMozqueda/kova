"""Container entrypoint preserving the complete native application's guards."""

import os

from app.config import settings
from app.main import app as application
from app.middleware.resident_identity import ResidentIdentityMiddleware
from app.native_checks import validate_image_identity, validate_storage_transport

# Keep native development/import behavior unchanged. The production controller
# explicitly enables the container flag together with its durable rate limiter.
if settings.cloudflare_container_mode:
    validate_image_identity(os.environ.get("KOVA_IMAGE_SHA"), settings.kova_release_sha)
    if settings.app_env == "production":
        # Only bind the HTTP listener after the existing app guards AND native
        # private-storage transport are ready. This never writes business data.
        validate_storage_transport()
app = ResidentIdentityMiddleware(application) if settings.cloudflare_container_mode else application
