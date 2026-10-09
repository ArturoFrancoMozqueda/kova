# Auditoría multidisciplinaria de KOVA — 2026-10-08

Base: `a18ba1e6b59752c73ed73b43bb3a1bb6b4ba2ef5` (`main`, PR #181).
Fecha de la solicitud: 8 de octubre de 2026, America/Mexico_City.
Destino solicitado: https://kovasuite.com/.

## Resultado y alcance

Seis agentes evaluaron seguridad; UX/accesibilidad; POS/offline; inventario y operaciones;
reportes/billing/asistente; y plataforma/rendimiento/dependencias. Hay 24 ramas de remediación,
con regresiones o comprobaciones de artefactos, y una rama conjunta `codex/audit-verified`.
Las prioridades P1 corresponden a recuperación y posible duplicación de ventas; P2 a errores
funcionales o de seguridad reproducidos; P3 a rendimiento sin pérdida de integridad.

La evaluación autenticada de producción **no se completó**. El proxy del entorno rechazó
el túnel HTTPS a `kovasuite.com` con HTTP 403 antes de llegar a KOVA. Las credenciales
proporcionadas no se utilizaron, guardaron ni incluyeron en archivos. Se solicitó habilitar
los dominios del sitio en la configuración del entorno. Este 403 no prueba un fallo de KOVA.

Las pruebas reales descritas aquí usan FastAPI y PostgreSQL/pgvector locales, negocios
efímeros y cookies reales; los escenarios de navegador con respuestas interceptadas se
identifican por separado. No se efectuaron compras, emisiones fiscales, cambios en datos
productivos ni llamadas de inferencia de pago.

## Ramas y reproducciones

Los commits de esta tabla pertenecen a las ramas individuales; la rama conjunta contiene
cherry-picks equivalentes y resoluciones que conservan ambos comportamientos/regresiones.

| ID | Prioridad | Reproducción anterior → corrección | Rama | Commit fuente |
| --- | --- | --- | --- | --- |
| 01 | P2 | Dos renovaciones con el mismo refresh token devolvían `[200,200]` → bloqueo PostgreSQL permite `[200,401]`. | `codex/audit-auth-refresh-race` | `7908f8f` |
| 02 | P2 | Sesión persistida vencida seguía autenticada y permitía abrir turno con JWT vigente → comprobación de expiración en servidor. | `codex/audit-auth-expired-session` | `871be12` |
| 03 | P2 | Contraseñas admitidas superaban los 72 bytes de bcrypt y causaban 500 → validación UTF-8, login genérico y mensajes corregibles en registro/restablecimiento/invitación. | `codex/audit-auth-password-byte-limit` | `14829d5`, `856b116` |
| 04 | P2 | Menú móvil cerrado aparecía en teclado/árbol accesible; abierto no gestionaba foco → inert, semántica, Tab, Escape y retorno del foco. | `codex/audit-mobile-navigation` | `de16359` |
| 05 | P2 | Contraer escritorio y pasar a móvil ocultaba etiquetas → preferencia de contracción exclusiva de escritorio. | `codex/audit-responsive-sidebar` | `6711879` |
| 06 | P2 | Red/503/429 en invitación se presentaban como enlace vencido → reintento preserva formulario; 400 inválido sigue terminal; respuestas/redirecciones antiguas se cancelan. | `codex/audit-invitation-transient-recovery` | `c9b40ae` |
| 07 | P1 | Lote con ventas agotadas y recuperables dejaba entradas con lease en `syncing` al fallar la primera petición → envío conjunto de recuperables libera todo el lote. | `codex/audit-offline-batch-lease-recovery` | `7686c57` |
| 08 | P1 | Error transitorio durante cobro con navegador todavía online no programaba recuperación → temporizador respeta Retry-After/cooldown y cierre de sesión. | `codex/audit-checkout-transient-sync-retry` | `6f31cb0` |
| 09 | P1 | Rechazo definitivo restauraba carrito y conservaba UUID fallido, permitiendo otra identidad para el mismo cobro → recibo local y recuperación de la venta original; siguiente carrito vacío. | `codex/audit-checkout-preserve-failed-sale-identity` | `b7c96dd`, `8244640` |
| 10 | P2 | Devolución ofrecía cantidades originales tras devolver parcialmente o todo → solo unidades restantes y acción oculta cuando no quedan. | `codex/audit-refund-remaining-quantities` | `c5fed71` |
| 11 | P2 | Formulario enviaba cantidades fraccionarias a API que exige enteros → bloqueo antes del envío. | `codex/audit-refund-integer-quantities` | `eefa741` |
| 12 | P2 | Indicador móvil decía “Sincronizado” con ventas fallidas → aviso persistente de revisión y enlace a cola. | `codex/audit-offline-failed-sale-indicator` | `047b33d` |
| 13 | P2 | Misma clave/cuerpo PATCH o DELETE contra otro recurso devolvía el anterior sin aplicar el cambio; categoría→producto podía provocar 500 → valida destino/tipo/operación bajo lock, conserva hashes y replays legítimos. | `codex/audit-catalog-idempotency-target` | `115b095` |
| 14 | P2 | Producto gratuito válido no podía cobrarse; pedido de total cero se marcaba devuelto e impedía entrega → pago cero único permitido y clasificación exige devolución positiva. | `codex/audit-customer-orders-zero-total` | `c626096` |
| 15 | P2 | Buscar `%`, `_` o `\` producía comodines SQL mientras frontend usaba búsqueda literal → escape consistente y paginación intacta. | `codex/audit-customer-orders-literal-search` | `e30f8a6` |
| 16 | P2 | Respuesta lenta del periodo anterior sobrescribía gastos/total actual → solo última solicitud puede actualizar vista y errores. | `codex/audit-expense-period-race` | `695a5e0` |
| 17 | P2 | Límite de mes dependía de zona del navegador, discrepando del negocio → fecha/periodo esperan zona del negocio; CDMX/Tijuana/Cancún cubiertos. | `codex/audit-expense-business-dates` | `97a23a2` |
| 18 | P2 | Suscripciones past_due/unpaid ofrecían checkout que backend rechazaba; recuperación podía afirmar activación falsa → contacto oficial de recuperación y estados correctos. | `codex/audit-billing-payment-recovery` | `71c0df1`, `7a750e2` |
| 19 | P2 | Botones del asistente pedían preguntas no soportadas cuando solo había respuestas locales y recibían 503 → sugerencias ajustadas a capacidades y whitelist real. | `codex/audit-assistant-local-suggestions` | `3ece7c2` |
| 20 | P3 | Hero de 184 KiB no era la imagen precargada; se priorizaba captura ajena de 584 KiB → preload del recurso visible real. | `codex/audit-landing-lcp-preload` | `b17ebd9` |
| 21 | P2 | Override fast-uri 3.1.6 tenía confusión de autoridad/host → 3.1.8, regresión del parser original falla y nueva pasa. | `codex/audit-fast-uri-parser` | `56c8921` |
| 22 | P3 | PWA descargaba 11 PNG exclusivos de marketing para instalar Caja → precaché baja de 4,161.62 a 2,203.84 KiB (47%); conserva shell/Caja/cola/Dexie/fuentes/iconos. | `codex/audit-pwa-marketing-precache` | `f4be3cd` |
| 23 | P2 | Lock de herramientas mantenía advisories compatibles ya corregidos → actualiza Axios/Joi/YAML/source-map-js/brace-expansion sin cambios mayores; cinco hallazgos adicionales eliminados. | `codex/audit-dev-dependency-patches` | `93f8a04` |
| 24 | P3 | Spec atribuía gestión de empleados a manager aunque permisos/router/pruebas la reservan a owner → documentación alineada con el contrato vigente. | `codex/audit-employee-permission-docs` | `d0fc286` |

Dependencias entre ramas: `responsive-sidebar` incluye `mobile-navigation`; los parches dev
incluyen `fast-uri-parser`. Contraseñas tiene dos commits. El resto nace de la base común.
La integración resuelve solapamientos en gastos, RegisterView e invitaciones y conserva
las regresiones de las ramas originales.

## Cobertura y comprobaciones

| Área | Evidencia | Límite práctico |
| --- | --- | --- |
| Seguridad | Renovación concurrente, expiración persistida, bcrypt, registro/restablecimiento/invitación, cookies/CSRF, permisos y aislamiento. RLS con rol `kova_app` sin superuser/BYPASSRLS. | Configuración efectiva de producción, MFA real y servicios externos no inspeccionados. |
| POS/offline | Cobro efectivo/dividido, turnos, reembolsos, anulaciones, idempotencia, IndexedDB, cambio de negocio, leases y reintentos. | Sin terminal de pago física; devolución dividida sigue limitada por contrato. |
| Operaciones | Código/contratos de catálogo, lotes/reservas, ajustes/conteos, traspasos, compras/proveedores, clientes/pedidos; regresiones PostgreSQL de los bugs. | Inspección amplia no equivale a recorrer cada combinación de todos esos flujos en producción. |
| Reportes/billing/asistente | 253 pruebas backend y 214 frontend del dominio; groundedness y cálculos revisados; nuevas regresiones. | Sin compra/cancelación real Stripe, inferencia pagada ni flujo real de documentos externos. |
| UX/accesibilidad | Chromium escritorio y emulación Pixel 5; navegación/foco/diálogos/estados; axe serio/crítico en stack real local. | Sin VoiceOver/NVDA, Safari/iOS real, WebKit o Firefox. |
| Plataforma | Build/SSR/prerender, SEO, precaché, lint/TypeScript, contratos/release, bundle y auditoría npm. | Sin métricas de campo, headers/CDN o prueba de carga en el sitio real. |

Baseline conservado, antes de integrar cambios:

- Backend completo: **1,214 aprobadas**, 662.86 s; PostgreSQL local aislado.
- Frontend completo: **804 pruebas**, 802 aprobadas y 2 timeouts bajo carga simultánea.
  Ambos archivos repetidos sin cambios: **18/18 aprobadas**. El recorrido inicial no fue verde.
- Navegador con mocks: **161 aprobadas, 12 omitidas, 1 fallida** por timeout en sucursales;
  repetir ese escenario sin cambios dio **1/1 aprobada**. Las omitidas incluyen escenarios
  reservados a integración/producción; se verificaron aparte los cuatro de integración local.
- Stack real local con RLS: **4/4 aprobadas**: axe login/vistas, axe modal financiero,
  negocio→producto→stock→turno→cobro→persistencia y aislamiento entre dos negocios.
  El primer arranque frío tuvo un timeout; warmup y presupuesto local explícito permitieron
  completar el recorrido sin cambiar las expectativas originales.
- Contratos del repositorio: **50/50**; release frontend: **24 aprobadas y 1 omitida Windows**.
- Ramas individuales: pruebas focalizadas/regresiones, TypeScript/ESLint/Ruff según dominio.
- Integración backend de los cambios: **110/110 aprobadas**. Los recuentos de suites se
  solapan y no se deben sumar para declarar cantidad de pruebas únicas.

Validación conjunta final, con instalación limpia del lock definitivo:

- **859/859 unitarias frontend**, 150 archivos; 157.48 s.
- **110/110 backend de los cambios**, además del baseline completo de 1,214.
- **48/48 escenarios Chromium con mocks** de autenticación, Caja, devolución, cola,
  catálogo, pedidos, billing, sucursales y navegación móvil.
- **14/14 escenarios del artefacto construido**: navegación móvil, SEO y precaché.
- **4/4 recorridos del stack real local con RLS** sobre la implementación integrada.
- TypeScript, ESLint, Ruff de cambios, build/SSR/prerender, contrato OpenAPI crítico,
  exportación de OpenAPI versionado, import guard y contratos de release: aprobados.
- Escaneo de bundle: **99 archivos JS, cero patrones prohibidos**.

Las primeras pruebas integradas de navegador detectaron dos expectativas antiguas:
el enlace de soporte ya no era único y el carrito fallido ya no debía restaurarse.
Se actualizaron para verificar ambos contextos correctos y la única identidad de la venta,
manteniendo la recuperación exitosa y añadiendo comprobaciones de UUID/payload/IndexedDB.
La implementación corregida se conservó; no se ajustaron expectativas para ocultar fallos.

La evidencia estructurada se registra en `KOVA-AUDIT-2026-10-08.json`.
Los logs locales completos están en `/workspace/kova-audit-evidence/` y no forman parte
del bundle ni de la aplicación. La auditoría preserva las protecciones de autenticación,
RLS, ownership, cobros e idempotencia; no introduce datos simulados en rutas productivas.

## Pendientes concretos

1. **QA autenticada en kovasuite.com:** habilitar el host y las dependencias reales necesarias
   en la política del entorno, luego recorrer la cuenta autorizada. Las conclusiones locales
   no acreditan salud del despliegue ni de los datos actuales de esa cuenta.
2. **Devolución con pagos divididos:** artículo de $50 pagado efectivo $30 + transferencia $20
   no puede devolverse con el contrato de un método por devolución y topes por medio.
   Se requiere diseñar y probar distribución del reembolso entre medios. Quitar los topes
   comprometería la integridad financiera; no se hizo.
3. **Diez advisories dev restantes** tras patches compatibles: 2 critical, 5 high y 3 moderate
   (incluyen propagación por dependencias). Runtime npm: cero hallazgos. Vitest/Tinypool y
   Tailwind requieren estudiar compatibilidad/migraciones mayores; no se demostró explotación
   de KOVA en producción. Detalle completo en el JSON de evidencias.
4. **Proveedores y dispositivos:** cobros Stripe reales, PAC/CFDI, entregabilidad de correo,
   cargas del asistente y terminales requieren acceso/capacidades que no ejercimos aquí.

Los cambios quedan en ramas para revisión. Este trabajo no constituye publicación de una
nueva versión de producción ni cierre de los gates externos históricos del proyecto.
