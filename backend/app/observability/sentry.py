import sentry_sdk

from app.config import settings


def init_sentry() -> None:
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        # release ties every event to the running build so the ops dashboard can
        # correlate errors with a specific deploy/commit.
        release=settings.git_sha or None,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
    )
