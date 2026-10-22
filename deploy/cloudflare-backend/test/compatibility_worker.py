import base64
from datetime import datetime

from workers import Response, WorkerEntrypoint

from app.cfdi.certificates import CsdValidationError, validate_csd
from app.workers.crypto import AESGCM, Fernet, InvalidToken


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        from urllib.parse import urlparse

        if urlparse(request.url).path == "/instrumented-error":
            import sentry_sdk
            from fastapi import FastAPI

            from app.config import Settings
            from app.observability import sentry as monitoring
            from app.workers.asgi import RequestCoordinator
            from app.workers.bootstrap import install_sync_adapter
            from app.workers.context import execution

            install_sync_adapter()
            # The crypto fixture imports modules before application bootstrap;
            # supply its explicit synthetic telemetry configuration directly.
            monitoring.settings = Settings(
                _env_file=None, sentry_dsn=self.env.SENTRY_DSN, app_env="production",
            )
            monitoring.init_sentry()
            integrations = sentry_sdk.get_client().integrations
            assert {"fastapi", "starlette", "sqlalchemy", "httpx", "logging", "dedupe"} <= (
                set(integrations)
            )
            assert "boto3" not in integrations
            app = FastAPI()

            @app.get("/instrumented-error")
            async def fail():
                raise RuntimeError("workers-instrumented-error private-error-canary@example.com")

            async def application(env):
                return app

            token = execution.set(self.ctx)
            try:
                return await RequestCoordinator().fetch(application, request, self.env, self.ctx)
            finally:
                execution.reset(token)

        if urlparse(request.url).path == "/accountant-pdf":
            import io

            from app.workers.pdf import Canvas

            output = io.BytesIO()
            document = Canvas(output)
            document.setTitle("Resumen contable")
            document.setAuthor("Kova")
            document.setSubject("Periodo fiscal")
            document.setFont("Helvetica-Bold", 12)
            document.drawString(36, 750, "Negocio: Café <BT /Root>")
            document.showPage()
            document.setFont("Helvetica", 10)
            document.drawString(36, 720, "Total $123.45")
            document.save()
            return Response(output.getvalue(), headers={"Content-Type": "application/pdf"})

        if urlparse(request.url).path == "/asgi-stream":
            from app.workers.asgi import RequestCoordinator

            async def app(scope, receive, send):
                if scope["type"] != "http":
                    return
                try:
                    await send({"type": "http.response.start", "status": 200,
                                "headers": [(b"content-type", b"text/plain")]})
                    await send({"type": "http.response.body", "body": b"first",
                                "more_body": True})
                    await send({"type": "http.response.body", "body": b"second",
                                "more_body": True})
                    await send({"type": "http.response.body", "body": b"",
                                "more_body": False})
                finally:
                    await self.env.ASSISTANT_STORAGE.put("asgi-test-cleanup", "done")

            async def application(env):
                return app

            return await RequestCoordinator().fetch(application, request, self.env, self.ctx)
        fixtures = await request.json()
        from urllib.error import HTTPError

        from app.billing.stripe_client import (
            StripePriceClient,
            StripePriceError,
            StripeSubscriptionClient,
        )

        # Exercise the real provider client through the WASM Fetch transport,
        # with all external traffic intercepted by the test-only boundary.
        price = StripePriceClient().retrieve_price(
            secret_key="synthetic-test-only", price_id="worker-valid"
        )
        assert price == {"id": "worker-valid", "active": True}
        try:
            StripePriceClient().retrieve_price(
                secret_key="synthetic-test-only", price_id="worker-missing"
            )
        except StripePriceError as exc:
            assert isinstance(exc.__cause__, HTTPError)
            assert exc.__cause__.code == 404
            assert "resource_missing" in str(exc)
        else:
            raise AssertionError("Provider HTTP errors lost their category")
        subscription = StripeSubscriptionClient().update_cancel_at_period_end(
            secret_key="synthetic-test-only", stripe_subscription_id="worker-subscription",
            idempotency_key="synthetic-idempotency-key",
        )
        assert subscription == {"id": "worker-subscription", "cancel_at_period_end": True}
        from botocore.exceptions import BotoCoreError, ClientError

        from app.workers.context import environment
        from app.workers.storage import R2Client

        context = environment.set(self.env)
        try:
            storage = R2Client()
            key = "synthetic-tenant/synthetic-document"
            bucket = "kova-assistant"
            storage.put_object(Bucket=bucket, Key=key, Body=b"synthetic-private-content")
            storage.head_object(Bucket=bucket, Key=key)
            with storage.get_object(Bucket=bucket, Key=key)["Body"] as body:
                assert body.read() == b"synthetic-private-content"
            try:
                storage.head_object(Bucket="wrong-bucket", Key=key)
            except BotoCoreError:
                pass
            else:
                raise AssertionError("Unexpected bucket accepted")
            storage.delete_object(Bucket=bucket, Key=key)
            try:
                storage.head_object(Bucket=bucket, Key=key)
            except ClientError as exc:
                assert exc.response["ResponseMetadata"]["HTTPStatusCode"] == 404
            else:
                raise AssertionError("Deleted object remained available")
            missing = environment.set(None)
            try:
                try:
                    storage.head_object(Bucket=bucket, Key=key)
                except BotoCoreError:
                    pass
                else:
                    raise AssertionError("Missing binding must fail closed")
            finally:
                environment.reset(missing)
        finally:
            environment.reset(context)
        from app.workers.crypto import pbkdf2_hmac

        assert (
            pbkdf2_hmac("sha256", b"synthetic-password", b"synthetic-salt", 4096).hex()
            == fixtures["pbkdf2"]
        )
        for count in (0, -1, 1_000_001, True, "4096"):
            try:
                pbkdf2_hmac("sha256", b"synthetic-password", b"synthetic-salt", count)
            except ValueError:
                pass
            else:
                raise AssertionError("Unbounded key derivation accepted")
        key = fixtures["fernet_key"].encode()
        assert (
            Fernet(key).decrypt(fixtures["fernet_token"].encode())
            == b"synthetic-credential"
        )
        try:
            Fernet(key).decrypt(fixtures["fernet_token"][:-5].encode() + b"abcde")
        except InvalidToken:
            pass
        else:
            raise AssertionError("Unauthenticated Fernet accepted")
        encrypted = Fernet(key).encrypt(b"synthetic-worker-credential")
        decode = base64.b64decode
        cipher = AESGCM(decode(fixtures["gcm_key"]))
        nonce, aad, gcm = map(
            decode, [fixtures["nonce"], fixtures["aad"], fixtures["gcm"]]
        )
        assert cipher.decrypt(nonce, gcm, aad) == b"synthetic-token"
        try:
            cipher.decrypt(nonce, gcm, aad + b"other")
        except ValueError:
            pass
        else:
            raise AssertionError("Wrong GCM tenant accepted")
        from app.ops.mfa import _qr_data_url

        png = _qr_data_url(
            "otpauth://totp/Kova:qa%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Kova"
        )
        output = []
        for case in fixtures["cases"]:
            try:
                validate_csd(
                    decode(case["cer"]),
                    decode(case["key"]),
                    case["password"],
                    case["rfc"],
                    now=datetime.fromisoformat(fixtures["now"]),
                )
                code = "ok"
            except CsdValidationError as exc:
                code = exc.code
            output.append(
                {"label": case["label"], "expected": case["expected"], "actual": code}
            )
        # Schedule delivery immediately before returning, so the transport
        # must retain its task across the HTTP invocation boundary.
        from sentry_sdk.envelope import Envelope

        from app.observability.sentry import sanitize_sentry_event
        from app.workers.context import execution
        from app.workers.sentry import WorkersTransport

        context = execution.set(self.ctx)
        try:
            envelope = Envelope()
            envelope.add_event(
                sanitize_sentry_event(
                    {
                        "message": "workers-transport-qa",
                        "email": "private-qa@example.com",
                        "request": {"headers": {"cookie": "private-cookie-qa"}},
                    }
                )
            )
            WorkersTransport(
                {"dsn": "https://synthetic-public@sentry.test/1"}
            ).capture_envelope(envelope)
        finally:
            execution.reset(context)
        return Response.json(
            {
                "qr": png,
                "cases": output,
                "fernet": encrypted.decode(),
                "gcm": base64.b64encode(
                    cipher.encrypt(nonce, b"worker-token", aad)
                ).decode(),
            }
        )
