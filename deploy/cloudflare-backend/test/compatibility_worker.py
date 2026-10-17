import base64
from datetime import datetime
from workers import WorkerEntrypoint, Response
from app.workers.crypto import Fernet, AESGCM, InvalidToken
from app.cfdi.certificates import validate_csd, CsdValidationError


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        fixtures = await request.json()
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
