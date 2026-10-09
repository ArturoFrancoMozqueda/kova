# Evaluación real de producción y correcciones — 2026-10-08

El propietario autorizó evaluar el flujo real con su cuenta, formar tres equipos e implementar
las correcciones. La autorización de publicación está confirmada en esta sesión. No se guardaron
contraseñas, cookies, tokens, estados autenticados ni trazas del navegador en archivos de evidencia.

## Entorno y alcance

- Sitio: `https://kovasuite.com`; API: `https://api.kovasuite.com`.
- La integración de 24 ramas de auditoría se publicó mediante PR #182. CI y publicación terminaron
  correctamente; verificación pública del frontend, proxy y base de datos confirmó el SHA completo
  `f9d875c103b090c9f08a888db7464b3a2321bbd1`.
- Equipos: seguridad/backend, POS/inventario/pedidos y experiencia/accesibilidad. Cambios reunidos
  en `codex/production-comprehensive-fixes`, sobre esa versión de producción.
- Cuenta autenticada con rol propietario y suscripción activa. No se registraron ventas, compras,
  clientes, movimientos de caja, ajustes de inventario, CFDI ni cambios de suscripción en producción.
  Se conservó el turno abierto existente.
- Se realizó una consulta local exacta al asistente: «Revisa mis ventas de este mes», con el
  consentimiento vigente. Creó su conversación normal; no modificó datos operativos ni invocó
  inferencia externa. Las capacidades observadas indican documentos, mutaciones y correo desactivados.

## QA realizada contra producción

| Área | Recorrido y resultado previo a los arreglos adicionales |
| --- | --- |
| Acceso | Login real; cookies access/refresh HttpOnly, Secure y SameSite=Lax; CSRF Secure. |
| Navegación | Panel, caja, catálogo, inventario, clientes, pedidos, ventas, turnos, compras, análisis, gastos, configuración, suscripción, integraciones, asistente y cola de sincronización. |
| Configuración | Perfil, sucursales, recibo, empleados, cierres fiscales y formato/zona horaria. |
| Caja | Dos unidades del mismo producto: total correcto; efectivo insuficiente bloquea cobro; efectivo mayor calcula cambio; Escape cierra resumen y devuelve foco. No se cobró. |
| Reportes | Ventas de los últimos 30 días y conteo de tickets coinciden entre UI y API; método de pago y comparación usan datos registrados. Los estados iniciales de carga se esperaron antes de evaluar cifras. |
| Asistente | La consulta del mes calendario concuerda con API para exactamente el mismo rango; muestra fuentes y distingue ventas de utilidad. |
| Formularios | Alta de producto, cliente, compras/proveedor y ajuste de inventario abiertos y cerrados sin guardar. Pedido nuevo revisado en modalidades recoger/entregar. |
| Responsive | Rutas autenticadas a 1440 y 390 px; caja, reportes, pedidos y compras también a 320/768/1024 px, sin desbordamiento horizontal. Equipo UX: 32 recorridos públicos en ocho rutas y cuatro tamaños. |
| Accesibilidad | Axe WCAG A/AA en pantallas autenticadas, reportes poblados y formularios; los hallazgos se enumeran abajo. Las animaciones se dejaron terminar antes de medir contraste de diálogos. |
| Offline | Caja cargada conserva 15 productos y muestra «Sin conexión» al retirar la red; no se creó venta ni cola offline. Idempotencia y escrituras se verifican con pruebas aisladas. |
| Operación | Frontend/proxy/DB responden; CSP, HSTS, nosniff y Referrer-Policy presentes; API correlaciona respuestas con x-request-id. No se observaron errores JS o 5xx en los recorridos válidos. |

## Hallazgos corregidos

| Hallazgo | Consecuencia | Corrección y evidencia |
| --- | --- | --- |
| Validación 422 reflejaba `input` y contexto | Contraseñas/claves/datos podían regresar en errores | Conserva loc/msg/type sin reflejar entradas; pruebas de privacidad. |
| Logout global limitado por RLS al tenant actual | Sesiones propias de otros negocios seguían activas | Revoca por usuario autenticado mediante conexión privilegiada acotada; prueba RLS con otro usuario preservado. |
| Webhook Stripe sin verificar `livemode` firmado | Aceptación de eventos de prueba en producción live | Rechazo antes de cualquier escritura, manteniendo opt-in explícito y comportamiento local. |
| Firmas/UTF-8 u Origin/Referer malformados | Entradas no válidas causaban 500 | Validación de bytes/payload y parseo de origen fail-closed; regresiones adversas. |
| Cambio de lote reutilizaba estado anterior | Sobrescritura de fechas/código del lote siguiente | Identidad propia por producto/lote; prueba de cambio A→B. |
| Sugerencia tardía de caducidad | Pisaba una fecha capturada manualmente | Invalida sugerencias pendientes al editar fechas. |
| Cambio de pedido conservaba checkout completado | «Pedido cobrado» falso para otro pedido | Estado de checkout propio por pedido. |
| Editar→nuevo conservaba formulario anterior | Podía actualizar un pedido existente | Identidad de formulario por pedido o alta nueva. |
| Producto repetido no agrupaba partidas nuevas | Carrito más confuso e inconsistencias de cantidades | Agrupa identidad producto/modificadores sin mezclar notas distintas. |
| Reintento creaba claves nuevas | Riesgo de pedido/reserva duplicados si se perdió respuesta | Conserva clave por operación/payload sin cambios; prueba frontend y replay backend con una sola reserva. |
| Disponibilidad de pedidos incorrecta | Drafts inventaban stock y partidas repetidas omitían reservas | Acredita sólo reservas activas propias, suma por producto y conserva reservas ajenas ante faltante físico. |
| Diálogos reiniciaban foco al renderizar | Captura interrumpida y foco inicial incorrecto | Listener estable con callback actual; teclado, Escape y recuperación del trigger. |
| Gastos mostraba cero/stale durante carga/error | Total engañoso | Skeleton o valor desconocido hasta respuesta válida; regresiones de carga/error. |
| Títulos y landmark ausentes | Navegación asistida y pestañas poco claras | Títulos de acceso, clientes, asistente e integraciones; main de clientes y skip link público enfocable. |
| Badges success de contraste 2.36 | Estados pagado/entregado/activo poco legibles | Token de texto oscuro compartido; regresión de contraste Chromium. |
| Métricas del panel con dl/dt/dd anidados incorrectamente | Estructura ilegible para tecnología asistida | Agrupaciones semánticas válidas y regresión axe. |
| «Mes»/«Este mes» describía últimos 30 días | Discrepancia aparente frente al mes calendario del asistente | Etiquetas 7/30 días y periodo anterior equivalente, conservando definiciones de KPI. |
| Campos de pedidos sin etiqueta asociada | Axe critical y controles sin nombre accesible | IDs únicos, htmlFor y descripción del producto en controles de partida; Chrome en cuatro estados. |
| Respuestas autenticadas marcadas como públicas | No excluían explícitamente almacenamiento HTTP | Backend API y proxy con private/no-store y directivas de CDN; no se reprodujo fuga de datos. |
| Selector de rol de empleado sin nombre accesible | Axe critical select-name | Identifica el rol de cada empleado y conserva confirmación antes de escribir. |
| Gráfica personalizada truncada a 31 días | Omitía ventas posteriores aunque API admite 92 días | Representa el rango completo; regresión de 45 días incluye el último día. |
| Telemetría no consumía confirmaciones HTTP | Con no-store dejaba transportes pendientes en Chrome | Lee la confirmación antes de resolver; dos regresiones y recorrido real de cinco pantallas. |

Las últimas tres correcciones se identificaron durante la segunda pasada y tienen regresiones
propias; no requieren migraciones ni cambios de contratos o definiciones financieras.

## Verificación del conjunto integrado

- Backend completo final: 1277 pruebas aprobadas, PostgreSQL desechable UTC y pruebas RLS con rol sin bypass.
- Frontend completo final: 894 pruebas aprobadas en 154 archivos, incluidas caché/empleados/gráfica/telemetría.
- Chromium con mocks: 178 pruebas aprobadas; 13 skips deliberados de suites que exigen otro entorno.
- Preview completo del artefacto compilado final: 187 recorridos aprobados y 4 skips de integración/producción.
- Stack real final, sin mocks: 4 pruebas aprobadas; venta persistida/relectura y descuento de stock,
  aislamiento entre dos negocios, axe en cinco pantallas y modal financiero.
- Contratos de repositorio: 50 pruebas; publicación/recuperación: 24 aprobadas y un skip Windows.
- Ruff, ESLint, TypeScript/build, compatibilidad OpenAPI, prerender y escaneo de secretos del bundle aprobados.
- Cada equipo reprodujo fallos antes del arreglo y verificó regresiones. Detalle de seguridad en
  [KOVA-PRODUCTION-SECURITY-2026-10-08.md](KOVA-PRODUCTION-SECURITY-2026-10-08.md), y UX en
  [PRODUCTION-UX-2026-10-08.md](evidence/PRODUCTION-UX-2026-10-08.md).
- La CI del PR y la publicación deben validar el conjunto final y volver a verificar el SHA público
  antes de declarar los arreglos adicionales publicados.

La primera CI detectó cabeceras específicas que la política general sobrescribía. La implementación
conserva ahora el `no-store` explícito de exportaciones y la caché pública de los dos endpoints de
imágenes intencionalmente anónimos; las respuestas privadas y los errores conservan protección de
CDN. Las pruebas de exportaciones/logos originales no se alteraron. También se hicieron exactos dos
selectores E2E de «Rol»: el nuevo nombre accesible del rol de un empleado hacía ambiguo su antiguo
substring. No se cambió la expectativa de invitación, confirmación ni permisos.
El bloqueo de networkidle se reprodujo localmente: cuatro respuestas de telemetría quedaban sin
consumir. Después de arreglar la implementación, el recorrido original completo pasa en 5.9 s;
no se aumentó el timeout ni se eliminaron esperas o comprobaciones de accesibilidad.

## Límites explícitos de cobertura

Esta evaluación no certifica todos los escenarios posibles. No incluye lectores de pantalla reales,
Safari/iOS, impresoras/terminales físicas, instalación PWA en dispositivo, carga masiva productiva,
pagos/reembolsos Stripe live ni emisión fiscal. Facturapi/terminal no estaban conectados; gastos
estaba deshabilitado por el flag de la cuenta. Esos recorridos se revisaron mediante código y pruebas
aisladas donde existen; no se alteró configuración comercial para habilitarlos. Aislamiento entre
negocios, mutaciones y recuperación de respuestas perdidas se comprueban sin tocar el negocio real.
