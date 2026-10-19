import base64
import hashlib
import json
from pathlib import Path
import sys
import subprocess
from datetime import timedelta
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID
from app.tests.test_cfdi_certificates import (
    certificate,
    encrypted_key,
    NOW,
    RFC,
    PASSWORD,
    kdf_envelope,
)
from app.cfdi.certificates import validate_csd, CsdValidationError

first = rsa.generate_private_key(public_exponent=65537, key_size=2048)
second = rsa.generate_private_key(public_exponent=65537, key_size=2048)
cases = []
inputs = [
    ("valid", certificate(first), encrypted_key(first), PASSWORD, RFC),
    ("wrong_rfc", certificate(first), encrypted_key(first), PASSWORD, "BBB010101BBB"),
    ("wrong_key", certificate(first), encrypted_key(second), PASSWORD, RFC),
    ("wrong_password", certificate(first), encrypted_key(first), "wrong-password", RFC),
    (
        "duplicate_rfc",
        certificate(first, duplicate_rfc=True),
        encrypted_key(first),
        PASSWORD,
        RFC,
    ),
    (
        "company_rfc",
        certificate(first, rfc=RFC + " / BBB010101BBB"),
        encrypted_key(first),
        PASSWORD,
        RFC,
    ),
    ("fiel", certificate(first, usage="fiel"), encrypted_key(first), PASSWORD, RFC),
    (
        "no_signature",
        certificate(first, usage="no_signature"),
        encrypted_key(first),
        PASSWORD,
        RFC,
    ),
    (
        "no_commitment",
        certificate(first, usage="no_commitment"),
        encrypted_key(first),
        PASSWORD,
        RFC,
    ),
    ("ca", certificate(first, ca=True), encrypted_key(first), PASSWORD, RFC),
    (
        "missing_usage",
        certificate(first, usage="missing"),
        encrypted_key(first),
        PASSWORD,
        RFC,
    ),
    (
        "trailing_certificate",
        certificate(first) + b"junk",
        encrypted_key(first),
        PASSWORD,
        RFC,
    ),
    ("invalid_key", certificate(first), b"not-a-key", PASSWORD, RFC),
]
for usage in ("key_encipherment", "ca", "crl"):
    inputs.append(
        (usage, certificate(first, usage=usage), encrypted_key(first), PASSWORD, RFC)
    )
for eku in (
    ExtendedKeyUsageOID.CLIENT_AUTH,
    ExtendedKeyUsageOID.EMAIL_PROTECTION,
    ExtendedKeyUsageOID.SERVER_AUTH,
):
    inputs.append(
        (
            "eku_" + eku.dotted_string,
            certificate(first, eku=[eku]),
            encrypted_key(first),
            PASSWORD,
            RFC,
        )
    )
inputs += [
    ("expired", certificate(first, after=NOW), encrypted_key(first), PASSWORD, RFC),
    (
        "future",
        certificate(first, before=NOW + timedelta(seconds=1)),
        encrypted_key(first),
        PASSWORD,
        RFC,
    ),
    ("missing_rfc", certificate(first, rfc=None), encrypted_key(first), PASSWORD, RFC),
    (
        "representative_rfc",
        certificate(first, rfc="BBB010101BBB / " + RFC),
        encrypted_key(first),
        PASSWORD,
        RFC,
    ),
    ("long_password", certificate(first), encrypted_key(first), "x" * 257, RFC),
    ("empty_password", certificate(first), encrypted_key(first), "", RFC),
    ("empty_certificate", b"", encrypted_key(first), PASSWORD, RFC),
    ("large_certificate", b"x" * (64 * 1024 + 1), encrypted_key(first), PASSWORD, RFC),
    ("empty_key", certificate(first), b"", PASSWORD, RFC),
    ("large_key", certificate(first), b"x" * (64 * 1024 + 1), PASSWORD, RFC),
]
for other in (
    ec.generate_private_key(ec.SECP256R1()),
    rsa.generate_private_key(public_exponent=65537, key_size=1024),
):
    inputs.append(
        (
            "unsupported_key_" + type(other).__name__,
            certificate(other),
            encrypted_key(other),
            PASSWORD,
            RFC,
        )
    )
for parameters in (
    {"count": 1_000_001},
    {"count": 0},
    {"salt": b""},
    {"salt": b"x" * 1025},
    {"key_length": 129},
    {"kdf": "unknown"},
):
    inputs.append(
        (
            "bounded_kdf_" + str(len(inputs)),
            certificate(first),
            kdf_envelope(**parameters),
            PASSWORD,
            RFC,
        )
    )
plain = first.private_bytes(
    serialization.Encoding.DER,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
inputs.append(("unencrypted_key", certificate(first), plain, PASSWORD, RFC))
for flags in (["-v1", "PBE-SHA1-3DES"], ["-v2", "des3"]):
    legacy = subprocess.run(
        [
            "openssl",
            "pkcs8",
            "-topk8",
            "-inform",
            "DER",
            "-outform",
            "DER",
            "-passout",
            "pass:" + PASSWORD,
            *flags,
        ],
        input=plain,
        capture_output=True,
        check=True,
        timeout=5,
    ).stdout
    inputs.append(("legacy_" + flags[-1], certificate(first), legacy, PASSWORD, RFC))

for label, cer, key, password, rfc in inputs:
    try:
        validate_csd(cer, key, password, rfc, now=NOW)
        expected = "ok"
    except CsdValidationError as exc:
        expected = exc.code
    cases.append(
        dict(
            label=label,
            cer=base64.b64encode(cer).decode(),
            key=base64.b64encode(key).decode(),
            password=password,
            rfc=rfc,
            expected=expected,
        )
    )
key = Fernet.generate_key()
token = Fernet(key).encrypt(b"synthetic-credential")
gcm_key = bytes(range(32))
nonce = bytes(range(12))
aad = b"synthetic-tenant:invitation"
gcm = AESGCM(gcm_key).encrypt(nonce, b"synthetic-token", aad)


def b64(b):
    return base64.b64encode(b).decode()


Path(sys.argv[1]).write_text(
    json.dumps(
        dict(
            cases=cases,
            now=NOW.isoformat(),
            fernet_key=key.decode(),
            fernet_token=token.decode(),
            gcm_key=b64(gcm_key),
            nonce=b64(nonce),
            aad=b64(aad),
            gcm=b64(gcm),
            pbkdf2=hashlib.pbkdf2_hmac(
                "sha256", b"synthetic-password", b"synthetic-salt", 4096
            ).hex(),
        )
    )
)
print(
    "Generated synthetic cross-runtime fixtures:",
    len(cases),
    "certificate cases, Fernet and AES-GCM",
)
