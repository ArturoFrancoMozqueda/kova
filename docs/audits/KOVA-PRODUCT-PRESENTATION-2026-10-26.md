# Presentación de producto y aceptación de salida — 2026-10-26

## Pedido y alcance

El propietario pide revisar todo Kova para que no aparezcan códigos internos, etiquetas de
desarrollo ni funciones inexistentes como parte de la experiencia normal. La exigencia de
producto real incluye operación y recuperación, además de presentación. Wallet y proveedores
de pases pagados están fuera del alcance por decisión explícita del propietario.

Este corte cambia presentación frontend y documentación operativa. No modifica autenticación
backend, permisos, contratos financieros, datos productivos ni infraestructura desplegada.
Las migraciones 0096–0098 y las funciones de menú, pedido y lealtad pertenecen a los cortes
anteriores documentados en [Current Sprint](../current-sprint.md).

## Cambios y revisión

- Tarjeta: puntos y recompensa antes de identificación; QR visible; número de tarjeta bajo
  «Usar número de tarjeta», conservando copia manual. Se mantiene la información de vigencia,
  acceso desde el navegador y ajustes de devoluciones. No se inventan puntos ni beneficios.
- Menú, seguimiento, caja, clientes, pedidos, citas, servicio, CRM, compras, inventario,
  conciliación, reportes, configuración, asistente, automatizaciones y facturación: nombres,
  fechas, importes y enlaces útiles sustituyen IDs o versiones internas cuando eran visibles.
  Los destinos exactos y los identificadores de las operaciones se conservan internamente.
- Los folios reales, SKU, RFC y UUID fiscales necesarios para operar se conservan. Los
  diagnósticos de soporte requieren desplegar «Información para soporte»; el área privada de
  operadores conserva sus herramientas de investigación.
- Un filtro compartido presenta errores de conexión, permisos y servicio en español; conserva
  validaciones de negocio comprensibles y evita JSON, SQL, stack traces y códigos internos.
  No cambia la clasificación financiera de errores, cuerpos, claves ni reintentos de venta.
- Ventas pendientes conserva recuperación, cuarentena y aislamiento; ya no muestra UUID de
  productos ni métodos de pago internos. Los cierres siguen bloqueados por ventas sin resolver.
- Registro y recuperación ignoran tokens de desarrollo en respuestas locales; el usuario
  continúa por correo, sin verificación manual mediante token dentro del formulario.
- Configuración traduce roles heredados sin ampliar las opciones o permisos de acceso.
- Las instrucciones de monitoreo/restauración y la spec del smoke se alinean con Cloudflare.
  El smoke no acredita Checkout ni Stripe live; se elimina el flag documentado que no existía.
- La regla de calidad queda en `.claude/rules/frontend.md` y el contexto de producto para
  prevenir nuevas referencias técnicas en pantallas comerciales o públicas.

Archivos principales: `frontend/src/loyaltyCard/{LoyaltyCardScreen,MembershipEntry,CardView}.tsx`,
`frontend/src/lib/apiError.ts`, `frontend/src/i18n/messages.ts`,
`frontend/src/auth/{AuthView,ForgotPasswordView}.tsx`,
`frontend/src/offline/SyncQueueView.tsx` y `frontend/src/support/SupportDialog.tsx`, además de las
vistas de los módulos enumerados y sus pruebas. Las instrucciones operativas se actualizan en
`docs/deployment.md`, `docs/engineering-operations-index.md`, los runbooks de uptime/restauración
y `specs/ops/production_smoke.md`.

La revisión de JSX productivo cubrió más de 200 archivos. Se revisaron los valores visibles,
no se confundieron claves, atributos de formularios o destinos autorizados con texto público.
Esta auditoría no demuestra ausencia de cualquier defecto posible del producto.

## Verificación

- Suite frontend completa: 1,637 pruebas en 216 archivos aprobadas. El ajuste final de roles y
  los mensajes de recuperación/cierre se verifican además con 43 pruebas focales aprobadas.
- Build TypeScript/Vite/SSR/prerender, ESLint, contrato OpenAPI y bundle sin secretos aprobados.
  El contrato de release aprueba 128 pruebas; el lanzador específico de Windows se omite en macOS.
- Las expectativas de UI se actualizan por los cambios de texto autorizados. Se conservan
  las comprobaciones de importes, UUID de reintento, aislamiento e idempotencia. El test de
  edición desde análisis espera la navegación exacta sin relajar el producto que debe abrir.
- Cuatro recorridos sobre API/PostgreSQL reales, sin APIs interceptadas, aprueban alta desde
  menú, compra y puntos, canje y devolución, pedido y entrega. Usan negocios desechables locales
  y rol runtime con RLS. No representan operaciones productivas.
- Navegador sobre el build final: 330 recorridos pasan en la pasada completa; el único fallo
  era la expectativa de texto del reenvío de verificación, que ya muestra su espera de 30 segundos.
  Se corrige el test para exigir el botón deshabilitado durante esa espera y ausencia de tokens
  o verificación manual. Los tres tests de registro/login pasan al revalidar ese archivo; quedan
  cubiertos 331 recorridos distintos. El perfil preview omite 20 integraciones: cuatro se
  ejecutan aparte con datos reales locales y las otras 16 no se repiten. El smoke productivo
  queda excluido del perfil local.
- Browser confirma el QR, el número oculto inicialmente y su alternativa manual; el menú
  conserva su pedido al abrir la tarjeta en otra pestaña. Evidencia visual local guardada.
- No se acredita lectura con escáner físico ni una auditoría completa con lector de pantalla.

## Requisitos que todavía necesitan aceptación productiva

| Requisito | Evidencia disponible y límite |
| --- | --- |
| Publicar el cambio final | El árbol de trabajo y los recorridos están verificados localmente. Falta CI del SHA final, migraciones y smoke posteriores al despliegue aprobado. |
| Stripe live | La evidencia anterior es test-mode. La lectura de Billing no sustituye la aceptación live supervisada. |
| Correo transaccional | Sigue pendiente comprobar las plantillas y enlaces reales en Gmail/Outlook/Hotmail con entrega a bandeja de entrada. |
| Recuperación del servicio | La restauración lógica real del 10 de octubre comprobó datos, RLS y limpieza. No acredita recuperación completa de host, Auth/Storage/Vault, tráfico y RTO. |
| Aceptación de negocios pagados | Contrato, soporte y retención requieren el registro de aceptación externa establecido por el runbook. |

Fuentes: [gate operativo](../runbooks/ops-beta-gate.md),
[restauración real](KOVA-R2-REAL-RESTORE-2026-10-10.md),
[smoke y su cobertura](../../specs/ops/production_smoke.md),
[checklist de release](../claude/release-ga-checklist.md).
Ninguno de estos requisitos obliga a comprar Wallet, WhatsApp o una terminal bancaria.
