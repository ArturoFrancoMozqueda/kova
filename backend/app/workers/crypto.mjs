// Run cryptographic primitives in the platform's maintained implementation.
// Python's WebAssembly catalog currently predates Kova's cryptography security floor.
import {
  createCipheriv, createDecipheriv, createPrivateKey, createPublicKey,
  X509Certificate, pbkdf2Sync,
} from "node:crypto";

function bytes(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export function deriveKey(password, salt, iterations, length, algorithm) {
  return bytes(pbkdf2Sync(password, salt, iterations, length, algorithm));
}

export function encryptCbc(key, iv, data) {
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return bytes(cipher.update(data), cipher.final());
}

export function decryptCbc(key, iv, data) {
  const cipher = createDecipheriv("aes-128-cbc", key, iv);
  return bytes(cipher.update(data), cipher.final());
}

export function encryptGcm(key, nonce, data, aad) {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = bytes(cipher.update(data), cipher.final());
  return bytes(ciphertext, cipher.getAuthTag());
}

export function decryptGcm(key, nonce, data, aad) {
  if (data.length < 16) throw new Error("Invalid authenticated ciphertext");
  const cipher = createDecipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  cipher.setAuthTag(data.subarray(data.length - 16));
  return bytes(cipher.update(data.subarray(0, -16)), cipher.final());
}

export function inspectCertificate(der) {
  const cert = new X509Certificate(der);
  return {
    der: bytes(cert.raw),
    type: cert.publicKey.asymmetricKeyType,
    publicKey: bytes(cert.publicKey.export({ format: "der", type: "spki" })),
  };
}

export function inspectPrivateKey(der, password) {
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8", passphrase: password });
  return {
    type: key.asymmetricKeyType,
    publicKey: bytes(createPublicKey(key).export({ format: "der", type: "spki" })),
  };
}
