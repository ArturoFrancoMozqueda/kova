import base64
from datetime import datetime
from workers import WorkerEntrypoint, Response
from app.workers.crypto import Fernet, AESGCM, InvalidToken
from app.cfdi.certificates import validate_csd, CsdValidationError


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        fixtures = await request.json()
        from app.workers.context import environment
        from app.workers.storage import R2Client
        from botocore.exceptions import BotoCoreError, ClientError

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
