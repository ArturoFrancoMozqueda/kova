"""CSD preflight uses generated in-memory material, never taxpayer secrets."""

import shutil
import subprocess
from datetime import UTC, datetime, timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from app.cfdi import certificates
from app.cfdi.certificates import CsdValidationError, validate_csd

NOW = datetime(2026, 10, 9, tzinfo=UTC)
RFC = "AAA010101AAA"
PASSWORD = "synthetic-csd-test-password"


@pytest.fixture(scope="module")
def keys():
    return (
        rsa.generate_private_key(public_exponent=65537, key_size=2048),
        rsa.generate_private_key(public_exponent=65537, key_size=2048),
    )


def certificate(
    private_key,
    *,
    rfc=RFC,
    before=NOW - timedelta(days=1),
    after=NOW + timedelta(days=365),
    usage="csd",
    eku=None,
    ca=False,
    duplicate_rfc=False,
    public_key=None,
):
    subject = [x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic taxpayer")]
    if rfc is not None:
        subject.append(x509.NameAttribute(NameOID.X500_UNIQUE_IDENTIFIER, rfc))
    if duplicate_rfc:
        subject.append(x509.NameAttribute(NameOID.X500_UNIQUE_IDENTIFIER, RFC))
    builder = (
        x509.CertificateBuilder()
        .subject_name(x509.Name(subject))
        .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic test issuer")]))
        .public_key(public_key or private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(before)
        .not_valid_after(after)
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
    )
    if usage != "missing":
        builder = builder.add_extension(
            x509.KeyUsage(
                digital_signature=usage != "no_signature",
                content_commitment=usage != "no_commitment",
                key_encipherment=usage == "key_encipherment",
                data_encipherment=usage == "fiel",
                key_agreement=usage == "fiel",
                key_cert_sign=usage == "ca",
                crl_sign=usage == "crl",
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
    if eku is not None:
        builder = builder.add_extension(x509.ExtendedKeyUsage(eku), critical=False)
    return builder.sign(private_key, hashes.SHA256()).public_bytes(serialization.Encoding.DER)


def encrypted_key(private_key, password=PASSWORD):
    return private_key.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(password.encode("utf-8")),
    )


def assert_rejected(code, cer, key, password=PASSWORD, rfc=RFC):
    with pytest.raises(CsdValidationError) as caught:
        validate_csd(cer, key, password, rfc, now=NOW)
    assert caught.value.code == code
    assert PASSWORD not in str(caught.value)
    assert caught.value.__context__ is None
    assert caught.value.__cause__ is None


def test_valid_csd_preflight_is_in_memory_and_returns_no_sensitive_data(keys):
    cer = certificate(keys[0])
    key = encrypted_key(keys[0])
    assert validate_csd(cer, key, PASSWORD, RFC, now=NOW) is None


def test_company_rfc_uses_taxpayer_before_representative_separator(keys):
    key = encrypted_key(keys[0])
    cer = certificate(keys[0], rfc="AAA010101AAA / BBB010101BBB")
    assert validate_csd(cer, key, PASSWORD, RFC, now=NOW) is None
    assert_rejected("csd_rfc_mismatch", cer, key, rfc="BBB010101BBB")


@pytest.mark.parametrize("rfc", ["BBB010101BBB", None, "not-an-rfc", "BBB010101BBB / AAA010101AAA"])
def test_rfc_mismatch_is_rejected_before_provider_mutates_organization(keys, rfc):
    assert_rejected("csd_rfc_mismatch", certificate(keys[0], rfc=rfc), encrypted_key(keys[0]))


def test_duplicate_rfc_is_ambiguous_and_rejected(keys):
    assert_rejected(
        "csd_rfc_mismatch", certificate(keys[0], duplicate_rfc=True), encrypted_key(keys[0])
    )


@pytest.mark.parametrize("rfc", ["", "aaa010101aaa", "RFC-IN-OU", None])
def test_expected_issuer_rfc_must_be_configured_and_normalized(keys, rfc):
    assert_rejected("csd_rfc_mismatch", certificate(keys[0]), encrypted_key(keys[0]), rfc=rfc)


@pytest.mark.parametrize("password", ["", "x" * 257, None, "\ud800"])
def test_password_limits_and_invalid_unicode_do_not_echo_password(keys, password):
    assert_rejected("csd_invalid_password", certificate(keys[0]), encrypted_key(keys[0]), password)


@pytest.mark.parametrize("cer", [b"", b"x" * (64 * 1024 + 1), None])
def test_certificate_upload_bounds(keys, cer):
    assert_rejected("csd_invalid_certificate", cer, encrypted_key(keys[0]))


@pytest.mark.parametrize("key", [b"", b"x" * (64 * 1024 + 1), None])
def test_private_key_upload_bounds(keys, key):
    assert_rejected("csd_invalid_key", certificate(keys[0]), key)


def test_unparseable_certificate_and_trailing_bytes_are_rejected(keys):
    key = encrypted_key(keys[0])
    assert_rejected("csd_invalid_certificate", b"not-a-certificate", key)
    assert_rejected("csd_invalid_certificate", certificate(keys[0]) + b"extra", key)


def test_pem_certificate_is_not_accepted_as_sat_der(keys):
    parsed = x509.load_der_x509_certificate(certificate(keys[0]))
    assert_rejected(
        "csd_invalid_certificate", parsed.public_bytes(serialization.Encoding.PEM), encrypted_key(keys[0])
    )


def test_expired_and_future_certificates_are_rejected(keys):
    key = encrypted_key(keys[0])
    assert_rejected("csd_expired", certificate(keys[0], after=NOW), key)
    assert_rejected(
        "csd_not_yet_valid", certificate(keys[0], before=NOW + timedelta(seconds=1)), key
    )


@pytest.mark.parametrize(
    "usage", ["fiel", "missing", "key_encipherment", "ca", "crl", "no_signature", "no_commitment"]
)
def test_authentication_encryption_and_unknown_usage_never_upload_as_csd(keys, usage):
    assert_rejected(
        "csd_signature_only_required", certificate(keys[0], usage=usage), encrypted_key(keys[0])
    )


@pytest.mark.parametrize(
    "eku", [[ExtendedKeyUsageOID.CLIENT_AUTH], [ExtendedKeyUsageOID.EMAIL_PROTECTION], [ExtendedKeyUsageOID.SERVER_AUTH]]
)
def test_extended_authentication_purposes_are_not_signature_only_csd(keys, eku):
    assert_rejected(
        "csd_signature_only_required", certificate(keys[0], eku=eku), encrypted_key(keys[0])
    )


def test_ca_certificate_is_not_a_taxpayer_csd(keys):
    assert_rejected(
        "csd_signature_only_required", certificate(keys[0], ca=True), encrypted_key(keys[0])
    )


def test_invalid_private_key_wrong_password_and_unencrypted_key_are_rejected(keys):
    cer = certificate(keys[0])
    assert_rejected("csd_invalid_key_or_password", cer, b"not-a-key")
    assert_rejected("csd_invalid_key_or_password", cer, encrypted_key(keys[0]), "wrong-password")
    unencrypted = keys[0].private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    assert_rejected("csd_invalid_key_or_password", cer, unencrypted)


def test_private_key_must_match_certificate_public_key(keys):
    assert_rejected("csd_key_mismatch", certificate(keys[0]), encrypted_key(keys[1]))


def test_non_rsa_credentials_are_not_accepted_as_sat_csd():
    private_key = ec.generate_private_key(ec.SECP256R1())
    assert_rejected("csd_key_mismatch", certificate(private_key), encrypted_key(private_key))


def test_rsa_key_smaller_than_documented_minimum_is_rejected():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    assert_rejected("csd_key_mismatch", certificate(private_key), encrypted_key(private_key))


def tlv(tag, data):
    if len(data) < 128:
        length = bytes([len(data)])
    else:
        size = (len(data).bit_length() + 7) // 8
        length = bytes([128 | size]) + len(data).to_bytes(size)
    return bytes([tag]) + length + data


def integer(value):
    data = value.to_bytes(max(1, (value.bit_length() + 7) // 8))
    if data[0] & 128:
        data = b"\0" + data
    return tlv(2, data)


def kdf_envelope(*, count=2048, salt=b"synthetic-salt", kdf="pbkdf2", key_length=None):
    params = tlv(4, salt) + integer(count)
    if key_length is not None:
        params += integer(key_length)
    if kdf == "pbkdf2":
        derivation = tlv(48, tlv(6, bytes.fromhex("2a864886f70d01050c")) + tlv(48, params))
        # The encryption cipher is delegated to cryptography, not assumed AES.
        cipher = tlv(48, tlv(6, bytes.fromhex("2a864886f70d0307")) + tlv(4, b"12345678"))
        algorithm = tlv(6, bytes.fromhex("2a864886f70d01050d")) + tlv(48, derivation + cipher)
    elif kdf == "pkcs12":
        algorithm = tlv(6, bytes.fromhex("2a864886f70d010c0103")) + tlv(48, params)
    else:
        algorithm = tlv(6, bytes.fromhex("2a0304")) + tlv(48, params)
    return tlv(48, tlv(48, algorithm) + tlv(4, b"synthetic-ciphertext"))


@pytest.mark.parametrize(
    "parameters",
    [
        {"count": 1_000_001},
        {"count": 0},
        {"salt": b"x" * 1025},
        {"salt": b""},
        {"key_length": 129},
        {"kdf": "unknown"},
        {"kdf": "pkcs12", "count": 1_000_001},
    ],
)
def test_expensive_or_unknown_kdf_is_rejected_before_private_key_decryption(keys, monkeypatch, parameters):
    def forbidden_decryption(*_args, **_kwargs):
        pytest.fail("Unbounded KDF reached the cryptographic worker")

    monkeypatch.setattr(serialization, "load_der_private_key", forbidden_decryption)
    assert_rejected("csd_invalid_key_or_password", certificate(keys[0]), kdf_envelope(**parameters))


@pytest.mark.parametrize("kdf", ["pbkdf2", "pkcs12"])
def test_kdf_resource_boundary_accepts_supported_families(kdf):
    assert certificates._bounded_key_derivation(kdf_envelope(count=1_000_000, kdf=kdf))


@pytest.mark.parametrize("data", [b"\x30\x80", b"\x30\x83\x00\x01\x00", b"\x30\x02\x04", b"\x30\x81\x01\x00"])
def test_malformed_der_length_cannot_trigger_private_key_decryption(keys, monkeypatch, data):
    def forbidden_decryption(*_args, **_kwargs):
        pytest.fail("Malformed DER reached private key decryption")

    monkeypatch.setattr(serialization, "load_der_private_key", forbidden_decryption)
    assert_rejected("csd_invalid_key_or_password", certificate(keys[0]), data)


@pytest.mark.parametrize("args", [["-v1", "PBE-SHA1-3DES"], ["-v2", "des3"]])
def test_actual_legacy_pkcs12_and_pbes2_3des_keys_remain_supported(keys, args):
    openssl = shutil.which("openssl")
    if openssl is None:
        pytest.skip("OpenSSL CLI required to generate legacy PKCS8 test encryption")
    plain = keys[0].private_bytes(
        serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    completed = subprocess.run(
        [openssl, "pkcs8", "-topk8", "-inform", "DER", "-outform", "DER", "-passout", f"pass:{PASSWORD}", *args],
        input=plain, capture_output=True, check=True, timeout=5,
    )
    assert validate_csd(certificate(keys[0]), completed.stdout, PASSWORD, RFC, now=NOW) is None


def test_rsa_key_larger_than_resource_limit_is_rejected_before_private_key_parse(keys, monkeypatch):
    large_public_key = rsa.RSAPublicNumbers(65537, (1 << 8192) + 1).public_key()
    cer = certificate(keys[0], public_key=large_public_key)
    key = encrypted_key(keys[0])

    def forbidden_parse(*_args, **_kwargs):
        pytest.fail("Oversized RSA public key reached private key parsing")

    monkeypatch.setattr(serialization, "load_der_private_key", forbidden_parse)
    assert_rejected("csd_key_mismatch", cer, key)


def test_unsupported_certificate_public_key_algorithm_returns_sanitized_error(keys):
    cer = certificate(keys[0]).replace(
        bytes.fromhex("06092a864886f70d010101"), bytes.fromhex("06092a864886f70d010163"), 1
    )
    assert_rejected("csd_key_mismatch", cer, encrypted_key(keys[0]))
