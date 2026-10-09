# Alta fiscal administrada por Kova — 2026-10-09

## Resultado implementado

El owner configura los datos fiscales, activa facturación, carga su CSD y firma la autorización
sin crear una cuenta de Facturapi ni copiar llaves API. Kova crea una organización por tenant
con la credencial de plataforma, obtiene llaves separadas y las cifra internamente. Las conexiones
manuales existentes mantienen su organización/historial; no se adopta una cuenta externa sin
migración asistida. Documentos, impuestos, importes y estados fiscales conservan su contrato.

## Áreas y controles

- `backend/app/cfdi/setup.py`, `managed_provider.py`, `certificates.py`, `uploads.py`: alta durable,
  búsqueda exacta tras timeout, llaves cifradas y preflight CSD acotado en memoria.
- `router.py`, `schemas.py`, `models.py`, `config.py`: contratos adicionales bajo auth/CSRF,
  FISCAL_MANAGE/owner, billing y rate limits. Credencial de plataforma sólo en SecretStr del servidor.
- Migración `e9f2d5d835e6`, `db.py`, grants, fixtures y lifecycle: FORCE RLS, binding único,
  grants de columnas, startup, exportación sin secretos y purge coherentes.
- UI `ManagedCfdiSetupPanel`, `CfdiPanel`, `IntegrationsPage`, API y CSP: pasos claros, inputs
  efímeros, mensajes seguros accionables, iframe por clic, sin confirmar readiness desde el navegador.
- Reserva de tenant serializa cambios de configuración contra emisión incierta de todas las
  sucursales; los replays/reconciliación permanecen disponibles.
- Defecto detectado por suite completa en gastos: POST y GET usaban husos/formatos distintos
  para el mismo timestamp. DTO y serialización comunes devuelven UTC; regresión con PostgreSQL
  America/Mexico_City mantiene create/read/replay iguales, sin modificar importes/expense_date.

## Validación

- 43 pruebas nuevas de alta con FastAPI/PostgreSQL/auth reales y proveedor sintético persistente;
  RLS real verifica no-context/cross-tenant/column grants y servicio tras commits.
- 56 pruebas CSD: RFC propio, vigencia, keypair, RSA, usos CSD frente a FIEL, DER/KDF acotados,
  compatibilidad PBES2/PKCS12 con AES/3DES; material sintético generado en memoria.
- 53 pruebas nuevas de transporte + 60 existentes: rutas, JSON/multipart, tiempos, límites,
  errores sanitizados, no redirects/no retries y separación de ambientes.
- 7 pruebas nuevas de migración/cuenta: fresh head, upgrade con historial previo, RLS, downgrade
  protegido, exportación/purge. Suite previa de migraciones: 15 aprobadas sin reducir expectativas.
- Frontend completo: 942 tests; preview Chromium compilado: 204 aprobados, 6 skips deliberados
  de integración que requiere su stack. Cuatro escenarios fiscales, incluido CSD móvil/error/
  privacidad/autorización, mantienen los controles de emisión y reconciliación.
- Ruff, ESLint, TypeScript/build/SSR/prerender, compatibilidad OpenAPI, 99 bundles sin secretos,
  y 24 pruebas release aprobadas (1 skip Windows). CI/publicación deben confirmarse para el SHA.

Las expectativas de conexión manual en el browser cambiaron legítimamente por el alta integrada
solicitada; las validaciones de emisión/reconciliación no se relajaron. El mapa exhaustivo de
permisos de migraciones incorpora la tabla nueva con privilegios concretos, sin ampliar otros.
El primer full backend detectó el defecto de timestamps; se corrigió implementación y se volvió
a ejecutar la suite. Una primera corrida paralela de helpers de migración tuvo conflicto de
teardown de roles temporales; la corrida serial pasó sin cambiar tests ni borrar recursos ajenos.

## Requisitos pendientes de ejecución externa

Se requiere configurar la cuenta/llave de Facturapi administrada por Kova una vez en el servidor,
con su servicio contratado para Live. CSD/datos/manifiesto reales corresponden al emisor. Ninguna
prueba con stubs o material sintético demuestra timbrado SAT, cobro externo o firma de una persona.
No se ejecutaron mutaciones externas reales contra Facturapi ni se introdujeron datos fiscales
inventados en Sweet Home. Con la plataforma sin configurar, UI/API muestran indisponibilidad
honesta; ventas y solicitudes continúan disponibles. Runbook:
[alta administrada](../runbooks/managed-fiscal-onboarding.md).
