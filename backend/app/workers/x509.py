"""Small certificate inspection adapter for Kova's existing bounded CSD validator.

ASN.1 is decoded with asn1crypto; the platform validates certificate/key encodings
and decrypts private keys with node:crypto. This does not implement RSA or trust a
certificate issuer. The unchanged caller enforces RFC, usage, dates and key match.
"""

from types import SimpleNamespace

from asn1crypto import core, keys
from asn1crypto import x509 as asn1_x509

from app.workers.crypto import js_bytes, primitives


class UnsupportedAlgorithm(ValueError):
    pass


class ExtensionNotFound(Exception):
    pass


class DuplicateExtension(ValueError):
    pass


class KeyUsage:
    oid = "2.5.29.15"


class BasicConstraints:
    oid = "2.5.29.19"


class ExtendedKeyUsage:
    oid = "2.5.29.37"


class RSAPublicKey:
    def __init__(self, spki: bytes):
        info = keys.PublicKeyInfo.load(spki, strict=True)
        public = info["public_key"].parsed
        self._numbers = (public["public_exponent"].native, public["modulus"].native)
        self.key_size = self._numbers[1].bit_length()

    def public_numbers(self):
        return self._numbers


class RSAPrivateKey:
    def __init__(self, spki: bytes):
        self._public = RSAPublicKey(spki)

    def public_key(self):
        return self._public


class _OtherKey:
    pass


class _Subject:
    def __init__(self, value):
        self.value = value

    def get_attributes_for_oid(self, oid):
        # SAT uses a DirectoryString for 2.5.4.45. asn1crypto's generic X.500
        # mapping assumes a BIT STRING for this OID; decode attributes without
        # that mapping and retain the validator's strict string/type check.
        attributes = _Name.load(self.value.dump(), strict=True)
        return [
            SimpleNamespace(value=attribute["value"].parsed.native)
            for rdn in attributes
            for attribute in rdn
            if attribute["type"].dotted == oid
        ]


class _Attribute(core.Sequence):
    _fields = [("type", core.ObjectIdentifier), ("value", core.Any)]


class _Rdn(core.SetOf):
    _child_spec = _Attribute


class _Name(core.SequenceOf):
    _child_spec = _Rdn


class _Extensions:
    def __init__(self, value):
        self.value = value

    def get_extension_for_class(self, cls):
        extensions = {}
        for extension in self.value:
            oid = extension["extn_id"].dotted
            if oid in extensions:
                raise DuplicateExtension("Duplicate certificate extension")
            extensions[oid] = extension["extn_value"]
        if cls.oid not in extensions:
            raise ExtensionNotFound("Required certificate extension is missing")
        parsed = extensions[cls.oid].parsed.native
        if cls is KeyUsage:
            if not isinstance(parsed, set):
                raise ValueError("Invalid certificate usage")
            value = SimpleNamespace(
                digital_signature="digital_signature" in parsed,
                content_commitment="non_repudiation" in parsed,
                key_encipherment="key_encipherment" in parsed,
                data_encipherment="data_encipherment" in parsed,
                key_agreement="key_agreement" in parsed,
                key_cert_sign="key_cert_sign" in parsed,
                crl_sign="crl_sign" in parsed,
            )
        elif cls is BasicConstraints:
            value = SimpleNamespace(ca=bool(parsed["ca"]))
        else:
            value = parsed
        return SimpleNamespace(value=value)


class _Certificate:
    def __init__(self, der: bytes):
        inspected = primitives().inspectCertificate(js_bytes(der))
        self._der = bytes(inspected.der)
        if self._der != der:
            raise ValueError("Trailing certificate material")
        parsed = asn1_x509.Certificate.load(der, strict=True)
        tbs = parsed["tbs_certificate"]
        self.not_valid_before_utc = tbs["validity"]["not_before"].native
        self.not_valid_after_utc = tbs["validity"]["not_after"].native
        self.subject = _Subject(tbs["subject"])
        self.extensions = _Extensions(tbs["extensions"])
        self._key_type = inspected.type
        self._public_key = bytes(inspected.publicKey)

    def public_bytes(self, encoding):
        if encoding != "der":
            raise ValueError("Only DER is supported")
        return self._der

    def public_key(self):
        if self._key_type not in {"rsa", "rsa-pss"}:
            return _OtherKey()
        return RSAPublicKey(self._public_key)


def load_der_x509_certificate(der: bytes):
    try:
        return _Certificate(der)
    except Exception:
        raise ValueError("Invalid certificate") from None


def load_der_private_key(der: bytes, *, password: bytes):
    try:
        inspected = primitives().inspectPrivateKey(js_bytes(der), js_bytes(password))
        if inspected.type not in {"rsa", "rsa-pss"}:
            return _OtherKey()
        return RSAPrivateKey(bytes(inspected.publicKey))
    except Exception:
        raise ValueError("Invalid private key") from None


x509 = SimpleNamespace(
    load_der_x509_certificate=load_der_x509_certificate,
    KeyUsage=KeyUsage,
    BasicConstraints=BasicConstraints,
    ExtendedKeyUsage=ExtendedKeyUsage,
    ExtensionNotFound=ExtensionNotFound,
    DuplicateExtension=DuplicateExtension,
)
serialization = SimpleNamespace(
    Encoding=SimpleNamespace(DER="der"),
    load_der_private_key=load_der_private_key,
)
rsa = SimpleNamespace(RSAPublicKey=RSAPublicKey, RSAPrivateKey=RSAPrivateKey)
NameOID = SimpleNamespace(X500_UNIQUE_IDENTIFIER="2.5.4.45")
