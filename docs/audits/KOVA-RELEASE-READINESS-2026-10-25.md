# Preparación de publicación de experiencia y continuidad

Fecha: 25 de octubre de 2026. Entrega revisable en el
[PR #277](https://github.com/ArturoFrancoMozqueda/kova/pull/277), rama
`fix/experience-release-readiness`. Esta auditoría no acredita un despliegue productivo.

## Corrección de los dos fallos de identidad

Los errores al construir `Request` con `AbortSignal` procedían de un `node_modules` desfasado:
Vitest instalado 3.2.7 frente a 4.1.11, ya fijado en package.json y package-lock.json de `main`.
Una instalación limpia mediante `npm ci` restaura el entorno previsto. Vitest 4.1.11 resuelve la
interoperabilidad de Request de Node y las señales de jsdom, incluyendo los listeners DOM.
No se cambian el lockfile, `AuthContext.identity.test.tsx`, código de autenticación ni
`src/test-setup.ts`. Pasan las 30 pruebas originales de identidad.

`frontend/src/test-environment.test.ts` añade tres garantías con constructores globales reales:
conservación del body y del motivo de cancelación en Request/clones; eliminación del listener
DOM después de abortar; y propagación de una señal cancelada antes de construir Request/clones.
No sustituye Request/AbortController/AbortSignal por mocks ni omite expectativas originales.

El backend también se sincronizó con `uv sync --frozen` sin editar `uv.lock`. Las pruebas se
ejecutaron contra PostgreSQL local separado de la base de aceptación de navegador, sin cargar
configuración productiva. Se usó caché Python aislada para evitar rutas de bytecode de otro entorno.

## Preparación integrada

Se incorporó `main` hasta `eb1ba37c`, conservando los cambios recientes del centro de control
y el enlace/QR fijo del menú. La entrega incluye la experiencia compartida, continuidad del
ciclo comercial y piloto asistido de WhatsApp que estaban pendientes en el checkout.
Los informes previos conservan sus resultados históricos y enlazan este cierre.

La validación ampliada encontró dos problemas de infraestructura de E2E y los corrigió:

- Postventa consultaba el historial inmediatamente después del click final; el texto podía
  coincidir con la propia textarea antes del guardado. Ahora espera la respuesta POST correcta
  y el formulario limpio antes de consultar. Conserva las siete entradas, versiones 7→1,
  tres notas y las aserciones de dinero sin cambios.
- La captura de WhatsApp escribía en `/private/tmp`, exclusivo de macOS. Usa
  `testInfo.outputPath`, que aísla artefactos por prueba y funciona también en Linux/CI.
  Conserva captura completa, axe, overflow, vinculación y confirmación explícita del envío.

## Evidencia de validación

| Comprobación | Resultado local |
|---|---|
| Unitarias frontend completas | 1,428 aprobadas, 197 archivos, Node 24.19.0 / Vitest 4.1.11 / jsdom 25.0.1. |
| Identidad + contratos nuevos de cancelación | 33 aprobadas; identidad original intacta. |
| Backend completo con PostgreSQL | 2,105 aprobadas, sin fallos ni omisiones. |
| Navegador preview, escritorio y móvil | 311 aprobadas, 16 omisiones previstas del perfil preview; integración real se ejecuta por separado. |
| Integración completa con API, PostgreSQL y RLS reales | 15 aprobadas; incluye ciclo comercial completo, postventa, identidad del cliente y aislamiento entre negocios. |
| Capturas de WhatsApp después del ajuste portable | 3 aprobadas a 1440/390/320 px. |
| Postventa real después de sincronizar el guardado | Aprobada con las siete entradas originales. |
| Controlador nativo de Cloudflare | 28 aprobadas. |
| Contratos de publicación/recuperación | 128 aprobados; un smoke de launcher Windows omitido por ejecutarse en macOS. |
| TypeScript, ESLint y Ruff | Aprobados. |
| Build cliente, SSR y prerender | Aprobados. |
| Contrato OpenAPI, guard E2E y secretos en bundle | Aprobados. |

Las comprobaciones de CI se repiten sobre cada commit del PR: integración Docker real,
FastAPI/PostgreSQL, Cloudflare Free/PostgreSQL, aceptación nativa, migraciones/reversibilidad,
seguridad/dependencias, parser aislado/antivirus, contenedor reproducible/SBOM, frontend y contratos.
El gate agregado **CI required** del último commit del
[PR](https://github.com/ArturoFrancoMozqueda/kova/pull/277/checks) determina la aptitud para fusionar.
Los jobs de provisión y publicación productiva se omiten deliberadamente en pull requests;
no se omiten ni relajan gates para hacer pasar la entrega.

## Publicación y límites

El pipeline existente de `main` conserva su entorno de producción, verificación de la versión
actual, smoke y recuperación. No se cambian sus permisos ni se ejecuta publicación desde esta
rama. La preparación no modifica secretos, datos productivos, precios, permisos, RLS o gates.
No añade migraciones. Los directorios locales de marketing y capturas QA no forman parte del PR.

WhatsApp conserva el interruptor global desactivado y activación explícita por conexión.
La entrega no certifica entrega real Meta, PSP, CFDI, hardware ni pago al proveedor: requieren
configuración y aceptación independientes. La aceptación del proceso interno está documentada
en el [informe de continuidad](KOVA-EXPERIENCE-CONTINUITY-2026-10-25.md).

Publicar requiere la aprobación explícita del usuario y los gates del último commit aprobados.
Este corte prepara el PR; no lo fusiona ni despliega.
