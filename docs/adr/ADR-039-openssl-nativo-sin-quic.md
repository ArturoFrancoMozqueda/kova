# ADR-039 — OpenSSL de la API nativa sin QUIC

Fecha: 2026-11-24

## Contexto

Los avisos CVE-2026-107494 y CVE-2026-124709 afectan a OpenSSL 3.5 de Debian Trixie. El contenedor de la API recibe HTTP por un puerto TCP privado y usa TLS para sus conexiones salientes. La implementación QUIC de OpenSSL queda fuera de ese flujo. Debian 12 se probó en una imagen candidata y su escaneo detectó hallazgos adicionales en zlib y Kerberos. [Avisos de Debian para CVE-2026-107494](https://security-tracker.debian.org/tracker/CVE-2026-107494) · [CVE-2026-124709](https://security-tracker.debian.org/tracker/CVE-2026-124709)

## Decisión

Conservar Debian 13. Compilar `libssl.so.3` con `no-quic` desde la fuente de Debian `3.5.9-1~deb13u1`, fijada por SHA-256. Conservar la revisión del paquete y su `libcrypto.so.3` de Debian. La imagen registra la huella de la biblioteca compilada, valida los símbolos exportados y prueba TLS 1.2 y 1.3 con verificación de certificado y nombre. [Receta de Debian](https://sources.debian.org/src/openssl/3.5.9-1~deb13u1/debian/rules) · [Opción `no-quic` de OpenSSL](https://github.com/openssl/openssl/blob/openssl-3.5.9/INSTALL.md#no-quic)

CI conserva la salida original de Trivy. La decisión complementaria sólo acredita esos dos avisos con la versión exacta del paquete cuando el proceso aislado carga la biblioteca compilada y comprueba sus bytes. Un hallazgo adicional, un error de escaneo o una versión diferente impiden esa decisión.

## Vigencia y salida

Responsable: mantenedores de Kova. La revisión vence el `2026-12-02T03:50:00Z`. Cuando Debian publique la corrección para ambos avisos, incorporar el paquete firmado o el digest actualizado de Distroless y retirar la compilación y la decisión temporal. El reemplazo debe aprobar Trivy, la prueba del runtime y la aceptación nativa en AMD64. La reversión usa el mecanismo de release de Kova.
