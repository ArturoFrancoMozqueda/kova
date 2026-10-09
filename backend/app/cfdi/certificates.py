"""Bounded, in-memory CSD preflight before any provider upload.

This is not SAT chain/revocation/LCO validation. Facturapi must still accept the
CSD and report production readiness before live issuance. No issuer-name, OU or
certificate-policy heuristic is used to claim that an arbitrary certificate is
a SAT CSD. The signature-only KeyUsage gate excludes encryption/authentication
credentials, including the e.firma profile documented by the DOF:
https://sidof.segob.gob.mx/notas/docFuente/5457756 (disposición TERCERA).
RFC subject attribute: X500uniqueIdentifier, same primary source.
Provider upload changes legal.tax_id, so scope is checked BEFORE that mutation:
https://docs.facturapi.io/api/ (Subir certificados CSD).

Callers must not persist, log or add these arguments to exception diagnostics.
"""

import re
from datetime import UTC, datetime

from cryptography import x509
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

MAX_CERTIFICATE_BYTES = 64 * 1024
MAX_PRIVATE_KEY_BYTES = 64 * 1024
MAX_PASSWORD_LENGTH = 256
MAX_KDF_ITERATIONS = 1_000_000
MAX_KDF_SALT_BYTES = 1024
_RFC = re.compile(r"[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}\Z")
# DER OID value bytes, as defined by RFC 8018 / RFC 7292 (not SAT type markers).
_PBES2 = bytes.fromhex("2a864886f70d01050d")
_PBKDF2 = bytes.fromhex("2a864886f70d01050c")
_LEGACY_PBE = {
    bytes.fromhex("2a864886f70d0105") + bytes([ending])
    for ending in (1, 3, 4, 6, 10, 11)
} | {
    bytes.fromhex("2a864886f70d010c0103"),  # PKCS12 SHA1/3-key 3DES
    bytes.fromhex("2a864886f70d010c0104"),  # PKCS12 SHA1/2-key 3DES
}


def _der_items(data: bytes) -> list[tuple[int, bytes]]:
    """Read a small, definite-length DER container, never a recursive ASN.1 tree."""
    items = []
    offset = 0
    while offset < len(data):
        if len(items) >= 8 or offset + 2 > len(data):
            raise ValueError("Invalid DER container")
        tag, length = data[offset], data[offset + 1]
        offset += 2
        if tag & 31 == 31:
            raise ValueError("Unsupported DER tag")
        if length & 128:
            count = length & 127
            if not 1 <= count <= 3 or offset + count > len(data) or data[offset] == 0:
                raise ValueError("Invalid DER length")
            length = int.from_bytes(data[offset:offset + count])
            offset += count
            if length < 128:
                raise ValueError("Noncanonical DER length")
        end = offset + length
        if end > len(data):
            raise ValueError("Truncated DER container")
        items.append((tag, data[offset:end]))
        offset = end
    return items


def _positive_integer(item: tuple[int, bytes], maximum: int) -> int:
    tag, data = item
    if (
        tag != 2 or not 1 <= len(data) <= 4 or data[0] & 128
        or (len(data) > 1 and data[0] == 0 and not data[1] & 128)
    ):
        raise ValueError("Invalid DER integer")
    value = int.from_bytes(data)
    if not 1 <= value <= maximum:
        raise ValueError("DER integer exceeds resource bound")
    return value


def _bounded_key_derivation(data: bytes) -> bool:
    """Reject expensive KDFs BEFORE OpenSSL can execute attacker-chosen work.

    RFC 8018 PBES2/PBKDF2 permits supported ciphers, not only AES, and optional
    key length/PRF. RFC 7292 PKCS12 3DES and RFC 8018 PBES1 use salt/iterations.
    Cryptography still verifies/decrypts the complete encoding afterwards.
    """
    accepted = False
    try:
        outer = _der_items(data)
        if len(outer) != 1 or outer[0][0] != 48:
            return False
        envelope = _der_items(outer[0][1])
        if len(envelope) != 2 or envelope[0][0] != 48 or envelope[1][0] != 4:
            return False
        algorithm = _der_items(envelope[0][1])
        if len(algorithm) != 2 or algorithm[0][0] != 6 or algorithm[1][0] != 48:
            return False
        oid = algorithm[0][1]
        parameters = _der_items(algorithm[1][1])
        if oid == _PBES2:
            if len(parameters) != 2 or any(item[0] != 48 for item in parameters):
                return False
            kdf = _der_items(parameters[0][1])
            if len(kdf) != 2 or kdf[0] != (6, _PBKDF2) or kdf[1][0] != 48:
                return False
            parameters = _der_items(kdf[1][1])
            if not 2 <= len(parameters) <= 4:
                return False
            optional = parameters[2:]
            if optional and optional[0][0] == 2:
                _positive_integer(optional.pop(0), 128)
            if optional:
                if len(optional) != 1 or optional[0][0] != 48:
                    return False
                prf = _der_items(optional[0][1])
                allowed_prfs = {
                    bytes.fromhex("2a864886f70d02") + bytes([ending])
                    for ending in range(7, 14)
                }
                if not prf or prf[0][0] != 6 or prf[0][1] not in allowed_prfs:
                    return False
                if len(prf) > 2 or (len(prf) == 2 and prf[1] != (5, b"")):
                    return False
        elif oid not in _LEGACY_PBE or len(parameters) != 2:
            return False
        salt_tag, salt = parameters[0]
        if salt_tag != 4 or not 1 <= len(salt) <= MAX_KDF_SALT_BYTES:
            return False
        _positive_integer(parameters[1], MAX_KDF_ITERATIONS)
        accepted = True
    except (ValueError, IndexError):
        pass
    return accepted


class CsdValidationError(ValueError):
    """Fixed public messages only; never retain crypto exception details."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def validate_csd(
    cer: bytes,
    key: bytes,
    password: str,
    expected_rfc: str,
    *,
    now: datetime | None = None,
) -> None:
    """Reject invalid/mismatched material without writing or external calls.

    Success establishes a preflight only. Files and password are deliberately
    absent from any returned object, metadata, journal or exception message.
    Encrypted PKCS#8 DER is required; PEM and unencrypted keys are rejected.
    """
    if not isinstance(cer, bytes) or not 0 < len(cer) <= MAX_CERTIFICATE_BYTES:
        raise CsdValidationError(
            "csd_invalid_certificate", "El archivo .cer debe pesar hasta 64 KB."
        )
    if not isinstance(key, bytes) or not 0 < len(key) <= MAX_PRIVATE_KEY_BYTES:
        raise CsdValidationError("csd_invalid_key", "El archivo .key debe pesar hasta 64 KB.")
    if not isinstance(password, str) or not 0 < len(password) <= MAX_PASSWORD_LENGTH:
        raise CsdValidationError(
            "csd_invalid_password", "La contraseña del CSD debe tener entre 1 y 256 caracteres."
        )
    encoded_password = None
    try:
        encoded_password = password.encode("utf-8")
    except UnicodeError:
        pass
    if encoded_password is None:
        raise CsdValidationError("csd_invalid_password", "Revisa la contraseña del CSD.")
    if not isinstance(expected_rfc, str) or not _RFC.fullmatch(expected_rfc):
        raise CsdValidationError("csd_rfc_mismatch", "Configura primero el RFC del negocio.")

    certificate = None
    try:
        certificate = x509.load_der_x509_certificate(cer)
        # Reject appended material even on parsers which accept a DER prefix.
        if certificate.public_bytes(serialization.Encoding.DER) != cer:
            certificate = None
    except (ValueError, TypeError, UnsupportedAlgorithm):
        pass
    if certificate is None:
        raise CsdValidationError("csd_invalid_certificate", "No se pudo leer el certificado .cer.")

    instant = now or datetime.now(UTC)
    if instant.tzinfo is None:
        raise ValueError("CSD validation clock must be timezone-aware")
    if instant < certificate.not_valid_before_utc:
        raise CsdValidationError("csd_not_yet_valid", "El certificado CSD todavía no está vigente.")
    if instant >= certificate.not_valid_after_utc:
        raise CsdValidationError(
            "csd_expired", "El certificado CSD está vencido. Carga uno vigente."
        )

    # Never scan CN/OU/issuer/representative RFC for a convenient match. For
    # company certificates the first part identifies the taxpayer; any suffix
    # after '/' may identify the representative and cannot authorize this tenant.
    attributes = certificate.subject.get_attributes_for_oid(NameOID.X500_UNIQUE_IDENTIFIER)
    taxpayer_rfc = None
    if len(attributes) == 1 and isinstance(attributes[0].value, str):
        taxpayer_rfc = attributes[0].value.split("/", 1)[0].strip().upper()
    if taxpayer_rfc != expected_rfc:
        raise CsdValidationError(
            "csd_rfc_mismatch", "El RFC del certificado debe coincidir con el RFC del negocio."
        )

    allowed_usage = False
    try:
        usage = certificate.extensions.get_extension_for_class(x509.KeyUsage).value
        allowed_usage = (
            usage.digital_signature
            and usage.content_commitment
            and not usage.key_encipherment
            and not usage.data_encipherment
            and not usage.key_agreement
            and not usage.key_cert_sign
            and not usage.crl_sign
        )
        try:
            constraints = certificate.extensions.get_extension_for_class(
                x509.BasicConstraints
            ).value
            allowed_usage = allowed_usage and not constraints.ca
        except x509.ExtensionNotFound:
            pass
        try:
            purposes = certificate.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
            # An authentication/encryption credential is outside this upload
            # flow; do not send an e.firma to the provider as a CSD.
            allowed_usage = allowed_usage and len(purposes) == 0
        except x509.ExtensionNotFound:
            pass
    except (x509.ExtensionNotFound, ValueError, x509.DuplicateExtension):
        allowed_usage = False
    if not allowed_usage:
        raise CsdValidationError(
            "csd_signature_only_required",
            "Carga tu Certificado de Sello Digital (CSD), no tu e.firma.",
        )

    if not _bounded_key_derivation(key):
        raise CsdValidationError(
            "csd_invalid_key_or_password",
            "No se pudo abrir el .key. Revisa el archivo y su contraseña.",
        )
    public_key = None
    try:
        public_key = certificate.public_key()
    except (ValueError, TypeError, UnsupportedAlgorithm):
        pass
    if not isinstance(public_key, rsa.RSAPublicKey) or not 2048 <= public_key.key_size <= 8192:
        raise CsdValidationError(
            "csd_key_mismatch", "El archivo .key debe corresponder al certificado CSD .cer."
        )
    private_key = None
    try:
        # A nonempty password also makes cryptography reject unencrypted DER.
        private_key = serialization.load_der_private_key(key, password=encoded_password)
    except (ValueError, TypeError, UnsupportedAlgorithm):
        pass
    if private_key is None:
        raise CsdValidationError(
            "csd_invalid_key_or_password",
            "No se pudo abrir el .key. Revisa el archivo y su contraseña.",
        )
    if (
        not isinstance(private_key, rsa.RSAPrivateKey)
        or public_key.public_numbers() != private_key.public_key().public_numbers()
    ):
        raise CsdValidationError(
            "csd_key_mismatch", "El archivo .key debe corresponder al certificado CSD .cer."
        )
