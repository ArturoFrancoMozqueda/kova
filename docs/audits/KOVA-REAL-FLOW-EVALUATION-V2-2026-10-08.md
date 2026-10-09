# Evaluación real V2 — iniciada 2026-10-08, cierre local 2026-10-09

Segunda pasada solicitada expresamente por el propietario después de publicar PR #183.
Base: `fb47b342489c0a32aad34bee0ad53c5538fcc4f2`, verificada en frontend/API/proxy/DB.
La autorización previa de correcciones y publicación continúa vigente.

## Equipos y método

Tres agentes navegaron la aplicación real con sesiones propias: POS/pedidos, operaciones/reportes,
y acceso/configuración. El integrador revisó los cambios y reprodujo el conjunto. Las bases locales
separadas permitieron probar mutaciones, reservas y permisos con PostgreSQL y RLS, sin interferencia.
No se guardaron credenciales, cookies, auth state, trazas o datos personales como evidencia productiva.
Las sesiones productivas de los equipos se cerraron normalmente.

No se cobraron ventas, alteraron turnos/stock, confirmaron importaciones, enviaron invitaciones/correos,
cambiaron suscripciones o emitieron CFDI en el negocio real. No se activaron conexiones ni capacidades
del asistente. La navegación conserva la telemetría y auditoría ordinarias de la aplicación.

## Navegación real y hallazgos

Se revisaron caja, ventas, pedidos, catálogo, importación, inventario e historiales, compras,
clientes, reportes y siete secciones de configuración, además de login/signup y páginas públicas.
Las pruebas de teclado, móvil, reflujo y errores de red complementaron axe; las mutaciones peligrosas
se ejecutaron sólo en el entorno desechable.

| Problema | Efecto y arreglo | Archivos principales |
| --- | --- | --- |
| Enter en captura de caja | Con efectivo válido provocaba submit implícito; evita cobrar desde inputs y conserva Enter/Space en Cobrar y el atajo explícito. | `frontend/src/register/RegisterView.tsx` |
| Configuración de lotes omitida | POST/PATCH descartaban cuatro campos admitidos; serializador conserva opciones, false/null y edición parcial. | `frontend/src/catalog/api.ts` |
| Historial de inventario | Contraste insuficiente y scroll sin foco; cantidades legibles y región nombrada con foco/scroll por teclado. | `frontend/src/inventory/InventoryView.tsx` |
| Perfil/recibo tras GET fallido | Formularios permitían guardar defaults; ahora requieren lectura confirmada, muestran error y reintentan. | `frontend/src/settings/SettingsView.tsx` |
| Gerente bloqueado | Configuración consultaba endpoints de empleados owner-only; evita esas lecturas y conserva permisos de servidor. | `frontend/src/settings/SettingsView.tsx` |
| Acciones sin recuperación | Bloquea invitaciones/guardados duplicados y conserva confirmaciones/borradores ante rechazo con aviso. | `frontend/src/settings/SettingsView.tsx` |
| Respuestas tardías | Ignora loaders/logos/confirmaciones de otro negocio o pestaña; una respuesta vieja no altera la sesión nueva. | `frontend/src/settings/SettingsView.tsx`, `LogoUploadField.tsx` |
| Cancelación rechazada | Ocultaba detalle y diálogo; mantiene contexto/nota, nombres accesibles y actualización explícita de versión. | `frontend/src/customerOrders/CustomerOrderDetailView.tsx` |
| Copia declarada sólo lectura | GET fallido online mostraba cache pero ofrecía mutaciones; edición/cobro/cancelación se bloquean. | `frontend/src/customerOrders/CustomerOrderDetailView.tsx` |
| Cancelación tras actualizar estado | Modal podía intentar cancelar pagado/cancelado; respeta contrato, incluyendo devolución total/anulación para owner/manager. | `frontend/src/customerOrders/CustomerOrderDetailView.tsx` |
| Semana/Mes en Ventas | Eran ventanas móviles; etiquetas 7/30 días conservan fechas y cálculos. | `frontend/src/orders/OrderListView.tsx` |
| Sucursales/fiscal bloqueadas | Dependían de perfil/recibo ajenos; loaders propios siguen disponibles y formularios mantienen bloqueo seguro. | `frontend/src/settings/SettingsView.tsx` |
| Pool/hilos bajo concurrencia | Esperas por conexión ocupaban workers necesarios para finalizar solicitudes; admisión async anterior a sesiones conserva pools, ORM, cleanup y RLS. | `backend/app/db.py` |

CSV UTF-8 y XLSX de una hoja previsualizaron datos sin confirmar. Fórmulas, múltiples hojas y
encabezados inválidos se rechazaron. El reporte personalizado de 45 días coincidió entre UI y API
en ventas netas, tickets y promedio. Abrir conteo negativo bloqueó Guardar sin ajustar inventario.
Las cifras/fechas de esas observaciones corresponden a la sesión descrita en la evidencia del equipo.
Siete enlaces públicos respondieron 200; no hubo errores JavaScript/desbordamiento a 390 px.

## Verificación del conjunto final

- Backend completo: **1282 pruebas aprobadas**, PostgreSQL local; tres warnings existentes.
- Frontend completo: **914 pruebas en 155 archivos aprobadas**.
- Artefacto compilado: **203 recorridos Chromium aprobados**, seis skips de integración deliberados.
- API/Postgres/RLS reales: **seis recorridos concurrentes aprobados en 6.7 s**, sin mocks.
  Incluyen aislamiento entre negocios, ventas persistidas/stock, lotes creados/editados por UI,
  ausencia de cobro con Enter en editor y cobro explícito único; accesibilidad de pantallas/modal.
- TypeScript/build/SSR/prerender, ESLint, Ruff, contrato API, escaneo del bundle,
  contratos de repositorio (50) y publicación/recuperación (24 y un skip Windows) aprobados.
- Script `test:integration` incluye el nuevo caso POS; CI ejecuta ambas regresiones reales nuevas.
- Cada arreglo tiene reproducción o regresión pertinente; no se relajaron fixtures, timeouts,
  workers, expectativas financieras, permisos ni tests originales de sucursales.

La primera ejecución local tuvo React duplicado por caché de dependencias compartida entre worktrees;
se aisló la caché temporal de Vite, sin cambiar producto ni pruebas. La siguiente ejecución reveló
saturación real: siete respuestas 500/10 s. La regresión PostgreSQL de pool pequeño reprodujo seis
fallos de ocho GET. Tras corregir admisión, los seis recorridos originales pasan con **451 solicitudes,
cero 500 y máximo 393 ms**, manteniendo concurrencia/expectativas y pools originales.
El fallo original de sucursales se resolvió en implementación; cinco regresiones adicionales y los
recorridos previos verifican independencia de secciones y respuestas tardías.

La CI debe repetir este conjunto y la publicación debe verificar frontend/API/proxy/DB con el SHA
exacto antes de declarar estos cambios publicados. Esta sección no certifica despliegue por sí sola.

## Evidencia de equipos

- [POS, pedidos y offline](evidence/REAL-FLOW-POS-V2-2026-10-08.md).
- [Catálogo, inventario, importación y reportes](evidence/REAL-FLOW-BUSINESS-V2-2026-10-08.md).
- [Acceso, configuración y permisos](evidence/REAL-FLOW-ACCESS-V2-2026-10-08.md).
- [Concurrencia y admisión de solicitudes DB](evidence/DB-REQUEST-ADMISSION-2026-10-09.md).

## Límites

No equivale a demostrar ausencia de todo bug posible. Impresoras/terminales físicas, Safari/iOS,
lector de pantalla real, pagos live, emisión fiscal y carga masiva productiva siguen fuera.
Funciones deshabilitadas se revisan mediante contratos/pruebas aisladas sin activarlas.
Sin clientes/proveedores/pedidos existentes, sus mutaciones/detalles se verifican localmente.
Las mediciones de navegador/red simulada son observaciones del entorno, no garantías en dispositivos.
