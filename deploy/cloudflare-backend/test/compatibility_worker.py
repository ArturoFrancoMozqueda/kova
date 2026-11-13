import base64
from datetime import datetime

from workers import Response, WorkerEntrypoint

from app.cfdi.certificates import CsdValidationError, validate_csd
from app.workers.crypto import AESGCM, Fernet, InvalidToken


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        from urllib.parse import urlparse

        if urlparse(request.url).path == "/assistant-qwen":
            import asyncio
            from types import SimpleNamespace
            from unittest.mock import patch

            import httpx
            from pydantic import SecretStr

            from app.assistant import grounding, provider, qwen

            loop = asyncio.get_running_loop()
            original_client = httpx.AsyncClient
            seen = []

            async def handler(outbound):
                import json

                await asyncio.sleep(0)
                assert asyncio.get_running_loop() is loop
                assert outbound.url.host == "api.cloudflare.com"
                body = json.loads(outbound.content)
                seen.append(body)
                assert body["max_completion_tokens"] == 128
                return httpx.Response(200, json={"choices": [{"finish_reason": "stop",
                    "message": {"content": '{"passage_ids":["p0"]}'}}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 20,
                              "total_tokens": 120, "neurons": 9.909090909090908}})

            import json

            messages = [{"role": "system", "content": grounding.EXTRACTION_SYSTEM},
                        {"role": "user", "content": json.dumps({"question": "Qué reviso",
                         "passages": [{"id": "p0", "source_id":
                          "6141fe70-9b98-4d18-865e-a874a72e1771", "title": "Guía",
                          "quote": "Revisa el comprobante original.", "ocr": False}]})}]
            with patch.object(provider, "settings", SimpleNamespace(
                assistant_generation_provider="cloudflare", assistant_model=qwen.MODEL,
                assistant_mutations_enabled=False, assistant_provider_verified=True,
                assistant_cloudflare_account_id="a" * 32,
                assistant_cloudflare_token=SecretStr("synthetic-test-only"),
            )), patch.object(httpx, "AsyncClient", side_effect=lambda **kw: original_client(
                transport=httpx.MockTransport(handler), **kw,
            )):
                result = provider.generate_passages(messages, model=qwen.MODEL)
            charged = qwen.verified_charge({"model": qwen.MODEL, "usage_profile": qwen.PROFILE,
                "input_tokens": 1000, "output_tokens": 128, "amount": 100},
                result["usage"], complete=result["completed"])
            return Response.json({"answer": json.loads(result["content"])["answer"],
                                  "same_event_loop": True, "calls": len(seen),
                                  "verified_neurons": charged})

        if urlparse(request.url).path == "/assistant-provider":
            import asyncio
            from types import SimpleNamespace
            from unittest.mock import patch

            import httpx
            from pydantic import SecretStr

            from app.assistant import openrouter

            loop = asyncio.get_running_loop()
            original_client = httpx.AsyncClient

            async def handler(outbound):
                await asyncio.sleep(0)
                assert asyncio.get_running_loop() is loop
                assert outbound.url.host == "openrouter.ai"
                return httpx.Response(200, json={
                    "provider": openrouter.RECIPIENT,
                    "choices": [{"finish_reason": "stop", "message": {"content": "Listo."}}],
                })

            with patch.object(openrouter, "ready", return_value=True), patch.object(
                openrouter, "settings", SimpleNamespace(
                    assistant_openrouter_api_key=SecretStr("synthetic-test-only"),
                ),
            ), patch.object(httpx, "AsyncClient", side_effect=lambda **kw: original_client(
                transport=httpx.MockTransport(handler), **kw,
            )):
                result = openrouter.generate(
                    [], [], model=openrouter.MODEL, structured=False, allowed_source_ids=None,
                )
            return Response.json({"content": result["content"], "same_event_loop": True})

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
