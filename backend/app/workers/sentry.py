"""Send already-sanitized envelopes with the platform request lifetime, no threads."""

import asyncio
import logging

from sentry_sdk.consts import VERSION
from sentry_sdk.transport import Transport

from app.workers.context import execution


class WorkersTransport(Transport):
    def capture_envelope(self, envelope):
        from workers import Request, fetch

        if self.parsed_dsn is None or execution.get() is None:
            return
        auth = self.parsed_dsn.to_auth("sentry.python/" + VERSION)
        body = envelope.serialize()

        async def send():
            try:
                request = Request(
                    auth.get_api_url(),
                    method="POST",
                    body=body,
                    headers={
                        "Content-Type": "application/x-sentry-envelope",
                        "X-Sentry-Auth": auth.to_header(),
                    },
                )
                response = await fetch(request)
                if response.status >= 400:
                    logging.getLogger("app.workers").warning("Sentry delivery unavailable")
            except Exception:
                logging.getLogger("app.workers").warning("Sentry delivery unavailable")

        execution.get().waitUntil(asyncio.ensure_future(send()))
