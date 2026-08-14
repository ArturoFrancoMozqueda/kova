# Exportación y eliminación de cuentas

KV-113 añade portabilidad de datos y una purga diferida para cuentas de negocio.

## Contratos

- `GET /api/v1/export/account` genera un ZIP con CSVs del tenant autenticado.
- `GET /api/v1/account/deletion` consulta una solicitud pendiente.
- `POST /api/v1/account/deletion` exige rol propietario, contraseña actual y el nombre exacto del negocio.
- `DELETE /api/v1/account/deletion` cancela una solicitud durante el plazo de espera.
- `POST /api/v1/account/internal/deletions/purge` ejecuta purgas vencidas y sólo acepta `X-Internal-Key`.

La exportación y el ciclo de eliminación son funciones sólo en línea. Los CSV neutralizan valores que una hoja de cálculo pudiera interpretar como fórmulas y omiten el contenido binario; sus metadatos permanecen exportados.

## Retención y billing

`ACCOUNT_DELETION_GRACE_DAYS` controla el plazo reversible y tiene un valor predeterminado de 30 días. Si la suscripción de Stripe ya pagada termina después, `purge_after` se extiende hasta ese fin de periodo. Programar la eliminación usa la cancelación idempotente existente de Stripe al final del periodo.

La purga borra todas las filas relacionales con `tenant_id`, el tenant y los usuarios que ya no pertenecen a otro tenant. Sólo conserva una constancia mínima sin usuario (`tenant_id`, estado y fechas) para demostrar que la solicitud terminó. Retenciones fiscales, contables o por reclamaciones requieren un proceso legal separado antes de introducir una excepción técnica.

## Operación

`.github/workflows/account-purge.yml` invoca la purga diariamente. El secreto `INTERNAL_API_KEY` debe contener el mismo valor en GitHub Actions y Fly. El endpoint usa una conexión privilegiada únicamente porque procesa varios tenants; la selección de vencidos se bloquea con `FOR UPDATE SKIP LOCKED`, por lo que los reintentos y ejecuciones concurrentes son seguros.

Ante una falla, GitHub Actions queda rojo y puede reintentarse con `workflow_dispatch`. Una cuenta no se purga antes de `purge_after`; repetir una ejecución no vuelve a procesar constancias completadas o canceladas.

## Gate operativo con tenant desechable

No ejecutar esta prueba con clientes reales. Crear un tenant desechable sin PII y registrar sólo IDs
anonimizados. Verificar, en orden: export ZIP; manifiesto y CSV esperados; neutralización de fórmulas;
solicitud con reautenticación y nombre exacto; `purge_after` al menos 30 días después; cancelación; y
una nueva solicitud. La purga real requiere autorización y un entorno desechable con reloj/datos de
prueba controlados. Después de purgar, confirmar que login y rutas tenant-scoped ya no dan acceso,
que otro tenant permanece intacto y que sólo queda la constancia mínima documentada.

La base activa elimina datos al ejecutar la purga, pero los dumps diarios de R2 se conservan según
`.github/workflows/db-backup.yml`. Con la configuración vigente pueden persistir hasta **7 días adicionales**
en backups después de la purga. Un restore no debe reactivar un tenant eliminado: durante una
recuperación se deben reconciliar las constancias de eliminación completadas antes de promover el
destino. Cualquier retención fiscal, disputa o hold legal debe tener aprobación y registro separados;
no se presume por defecto.
