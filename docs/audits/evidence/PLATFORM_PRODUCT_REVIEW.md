# Kova: plataforma, producto y continuidad operativa

Fecha: 2026-09-06 (America/Mexico_City). Auditoría de lectura y reproducciones locales aisladas; no se cambió implementación, tests, datos productivos ni infraestructura. No se leyeron secretos. Las observaciones del repositorio no certifican la configuración efectiva de proveedores.

## Resumen

El diseño tiene protecciones valiosas: contratos OpenAPI versionados, CI con integración PostgreSQL y navegador real, dependencias/secretos auditados, imagen reproducible y SBOM, frontend prerenderizado, catálogos y colas por tenant, leases transaccionales, UUID estable para ventas POS y preservación de filas legacy. El principal riesgo frontend surge de la composición de piezas correctas individualmente: cambios de sesión entre pestañas, respuestas perdidas, recargas del service worker y recuperación offline.

No se identificó un P0 en este alcance. Cinco defectos P1 necesitan corrección antes de ampliar la beta; el restore permanece además como gate operativo P1 explícitamente pendiente. No se afirma explotación ni incidentes reales.

## Hallazgos

### PP-01 — P1 / confianza alta: actualizaciones PWA recargan una caja con trabajo en curso

- Evidencia: `frontend/src/main.tsx:94` y `:141` llaman `forceReload()` desde `updatefound/statechange` y `controllerchange`. La comprobación `isReloadSafePath` existe sólo en el sondeo inicial de versión (`:33`). `frontend/src/pwaUpdate.ts:53` vacía caches y ejecuta `location.reload`; no tiene guard propio. `frontend/src/register/RegisterView.tsx:182` mantiene carrito y campos de cobro en estado React.
- Disparador: una PWA ya controlada recibe una nueva versión mientras el cajero tiene carrito o efectivo capturado. Ambos listeners pueden recargar `/register` sin consentimiento ni protección del trabajo. Las ventas que ya alcanzaron IndexedDB se conservan; lo vulnerable es el trabajo aún en memoria.
- Prueba ejecutada: transpilar el `main.tsx` real en una VM Node con navegador simulado, pathname `/register`, helper de seguridad que devuelve false y registro SW simulado. Invocar los dos listeners produjo `updatefoundReloads=1, controllerchangeReloads=1`. No demuestra un navegador productivo, sí la ejecución del camino defectuoso.
- Gap de prueba: `frontend/src/pwaUpdate.test.ts:74` sólo comprueba el helper de ruta; no ejecuta estos listeners.
- Cambio mínimo: centralizar la decisión de recarga para todos los disparadores y diferir mientras haya operación/edición activa; aplicar actualización tras un punto seguro. No basta cambiar el test del helper.
- Aceptación: PWA instalada, carrito y pago parcial capturados; instalar/activar un SW nuevo conserva el trabajo y permite terminar la venta exactamente una vez. Probar también otras formas en edición y recarga segura sin trabajo pendiente.
- Responsable: frontend/POS. Esfuerzo orientativo: 1–2 días con prueba de dos builds locales.

### PP-02 — P1 / confianza alta: un reintento manual no puede recuperar una venta que agotó intentos

- Evidencia: `frontend/src/offline/queue.ts:131` cambia failed→pending pero conserva `attempt_count`. El claim incrementa el contador (`:216`); `frontend/src/offline/syncWorker.ts:76` detecta el límite y `:82` marca failed sin enviar cuando supera 5. El botón de `SyncQueueView.tsx` llama justamente retryDeadLetter seguido de syncNow.
- Disparador: cinco fallos de red/5xx consumen los intentos, el siguiente ciclo mueve la venta a fallida. Una vez recuperado el backend, pulsar Reintentar nunca vuelve a probar el servidor.
- Reproducción ejecutada: cargar módulos reales queue y syncWorker mediante TypeScript→CommonJS en VM; Dexie con fake-indexeddb efímero; sembrar una fila failed con attempt_count=6; llamar retryDeadLetter y triggerSync. Resultado: `finalStatus="failed", attemptCount=7, syncRequests=0`. La base era en memoria y se eliminó al terminar.
- Impacto: dinero ya registrado localmente queda fuera del ledger central hasta intervención técnica; el control ofrecido al cajero no funciona.
- Cambio mínimo: separar intentos históricos del presupuesto de reintento actual o restablecer explícitamente el presupuesto al reintento manual, preservando UUID, tenant y ownership. Mostrar un motivo de fallo legible en español.
- Aceptación: agotar presupuesto, recuperar red/backend, pulsar Reintentar; ocurre una petición con UUID original y termina synced. Mantener exclusión entre tabs y límites de backoff automático.
- Responsable: frontend/offline. Esfuerzo: 0.5–1 día.

### PP-03 — P1 / confianza alta: cold start sin red termina en login aunque exista catálogo offline

- Evidencia: `frontend/src/auth/AuthContext.tsx:47` inicia loading; el probe transforma error de red en null y `:81` lo convierte en unauthenticated. `frontend/src/auth/RequireAuth.tsx:9` redirige a `/login`. `frontend/vite.config.ts` excluye login del navigation fallback. La recuperación del catálogo en `RegisterView.tsx` requiere llegar a la vista con tenant autenticado.
- Disparador: preparar dispositivo y turno online, cerrar/recargar app y abrir `/register` sin conectividad. AuthContext no conserva una identidad offline habilitada y no distingue fallo de red de sesión inválida.
- Prueba inspeccionada: `frontend/e2e/offline-sync.spec.ts:240` se titula cold offline, pero `:244` responde siempre con sesión autenticada; el flag offline sólo aborta catálogo/categorías/sync. `:269` recarga con auth todavía accesible. Por ello el test puede aprobar aunque el escenario completo falle.
- Impacto: un corte seguido de recarga/cierre accidental interrumpe caja. El caso de pérdida de red con app abierta sí tiene otra cobertura y no se declara roto.
- Claim: la [landing](https://kovasuite.com/) limita offline a dispositivo preparado y turno abierto; no explica que reiniciar la app requiera red. La [página de seguridad](https://kovasuite.com/seguridad) presenta continuidad de caja durante fallo de red. La evidencia disponible no respalda cold start, pese a comentarios/tests que lo nombran.
- Cambio mínimo: primero definir política segura de identidad offline, expiración local, dispositivo compartido y revocación; no persistir tokens ni conceder autenticación por un boolean local. Mientras se implementa, comunicar claramente la condición de mantener la caja abierta y usar un estado recuperable de conexión.
- Aceptación: navegador real/PWA instalada, auth incluido en corte de red, recarga y reapertura; verificar política acordada, tenant, turno y conciliación posterior. Cubrir sesión verdaderamente revocada aparte.
- Responsable: frontend + seguridad/POS. Esfuerzo: 2–4 días según política elegida.

### PP-04 — P1 / confianza alta en el código, reproducción integrada pendiente: pestañas conservan identidad anterior tras sustituirse las cookies

- Evidencia: `frontend/src/auth/AuthContext.tsx:119` deja de sondear cuando ya está authenticated. No hay BroadcastChannel ni invalidación por storage/focus para sesiones en ese módulo. `frontend/src/offline/activeTenant.ts:3` es memoria por contexto JS. `backend/app/auth/router.py:36` y `:177` reemplazan cookies al login; `frontend/src/lib/csrf.ts:19` lee la cookie CSRF vigente al enviar. `frontend/src/catalog/api.ts:82` crea categorías sin expresar el tenant que el usuario cree estar editando.
- Disparador reproducible propuesto: dos pestañas del mismo perfil; A muestra negocio A, otra cierra sesión y entra como B; volver a A sin recargar y crear una categoría. El navegador usa cookies/CSRF B, aunque A conserva su shell y formularios A.
- Impacto concreto: escritura de datos recién capturados en el negocio B bajo una UI que anuncia A; lecturas B también pueden etiquetarse/cachearse con tenant A en la pestaña vieja. Esto no es una evasión de RLS: el servidor aplica correctamente la sesión B. Es una discrepancia entre intención de UI e identidad efectiva.
- Offline: `frontend/src/offline/sync.ts` envía ventas sin expected tenant; `backend/app/sync/schemas.py:29` sólo declara sales y `backend/app/sync/router.py:31` usa membership actual. Productos exclusivos de A normalmente serán rechazados en B; no se afirma que toda venta cruzada sea aceptada.
- Cobertura existente: `frontend/e2e/offline-sync.spec.ts:79` cambia sesión mediante recargas de una página. Eso no prueba una pestaña simultánea que conserva estado anterior.
- Cambio mínimo: invalidación coordinada entre pestañas y comprobación servidor del tenant/sesión esperado para mutaciones sensibles. Una comprobación previa aislada no elimina la carrera entre comprobación y envío. Seguir usando cookies HttpOnly; el tenant esperado es condición de coincidencia, nunca autorización.
- Aceptación: mismo contexto navegador con dos páginas, sesiones A/B distintas; ninguna operación con intención A se confirma bajo B; caches y cola no adquieren datos B etiquetados como A. Incluir cambio de rol/usuario dentro del mismo tenant.
- Responsable: auth + frontend/API. Esfuerzo: 2–3 días.

### PP-05 — P1 / confianza alta: reintentar un reembolso parcial tras perder la respuesta genera otra identidad de operación

- Evidencia: `frontend/src/orders/api.ts:69` genera `crypto.randomUUID()` por llamada a createRefund (`:72`). `frontend/src/orders/OrderDetail.tsx:71` permite reenviar; tras excepción no reconcilia ni conserva clave. Backend `backend/app/orders/service.py:539` busca replay por la clave; `:574` sólo limita cantidad acumulada y `:605` saldo por método; `:720` confirma la transacción.
- Disparador: orden de 3 unidades, devolución de 1 confirmada en servidor, respuesta perdida; usuario vuelve a enviar el mismo formulario. La segunda petición tiene otra clave; quedan 2 unidades y saldo suficientes, de modo que una segunda devolución de 1 cumple los límites legítimos.
- Impacto: ledger, reposición y salida de caja pueden reflejar dos devoluciones por una intención. No se afirma que Stripe cobre al cliente: Kova registra estos movimientos, no procesa dinero de mostrador.
- Límites: devolución total puede ser rechazada por cantidad/saldo; ventas del POS con UUID duradero ya siguen otro camino más sólido. El defecto específico es la devolución parcial reintentada por la UI.
- Cambio mínimo: conservar clave por intención de devolución y payload estable hasta resultado definitivo; ante resultado incierto reconciliar usando esa identidad. Crear una nueva clave sólo para una nueva operación deliberada.
- Aceptación: respuesta perdida después de commit, reenviar dos veces; existe exactamente una devolución y un movimiento de stock/caja. Después permitir una nueva devolución explícita con clave nueva.
- Responsable: frontend/POS + API tests. Esfuerzo: 1–2 días.

### PP-06 — P2 / confianza alta: el rollback automatizado termina antes de la promoción y aceptación final

- Evidencia: `.github/workflows/ci.yml:379` depende de deploy-fly y post-deploy-read-only. Su condición sólo mira el segundo. Los pasos promote-vercel (`:350`) y release-acceptance (`:364`) no alimentan la recuperación. `frontend/scripts/verify-deployment.mjs:24` comprueba tres JSON de versión/health; no verifica HTML/assets del sitio promovido ni la reescritura `/api` a través del frontend.
- Disparador: checks previos verdes y backend nuevo activo; falla promoción o comprobación del dominio final. Workflow queda rojo, pero la recuperación automatizada definida no hace nada para ese fallo; puede quedar combinación de versiones o dominio no validado.
- Gap adicional: captura de previous_image acepta vacío (`.github/workflows/ci.yml:282`); el deploy continúa y la condición de rollback se vuelve imposible. `docs/deployment.md:142` dice detenerse si está vacío, pero CI no lo impone.
- Cambio mínimo: modelo explícito de estados de release, fallo cerrado si falta imagen anterior cuando sea exigible, captura verificable de frontend previo y política de recuperación según fase. No retroceder schema destructivo automáticamente. Añadir smoke público del sitio y `/api` reescrito sin mutaciones.
- Aceptación: simular fallo de candidate, promoción y acceptance por separado en un entorno desechable; verificar decisiones y hashes finales. Simular captura vacía y demostrar que no inicia despliegue.
- Responsable: plataforma. Esfuerzo: 1–3 días.

### PP-07 — P1 / confianza alta sobre ausencia de evidencia, no sobre fallos del backup: restore real sigue sin probarse

- Evidencia: `.github/workflows/db-backup.yml` implementa dump diario, carga R2, verificación del metadata checksum y retención 7 días. `docs/runbooks/ops-beta-gate.md:50` mantiene OPS-3 bloqueado; `docs/runbooks/restore-supabase-backup.md` describe un procedimiento, no su ejecución exitosa. El check de scripts valida contratos/preflight, no restaurabilidad de un dump real.
- Claim público coherente: [seguridad](https://kovasuite.com/seguridad) reconoce expresamente que el simulacro completo está pendiente. No hay una promesa falsa de recuperación ya probada en ese texto.
- Riesgo: el primer restore real ocurre durante incidente y revela permisos/roles, extensiones, datos faltantes o RTO incompatible con operación. Metadata almacenado no prueba integridad de bytes descargados ni que el dump pueda restaurarse.
- Acción: conservar este gate abierto, asignar responsable/capacidad de entorno desechable, ejecutar runbook con backup real autorizado, verificar roles/RLS, conteos e invariantes financieros, registrar RPO/RTO y limpieza. No ampliar compromisos de disponibilidad basándose sólo en workflows verdes.
- Aceptación: evidencia fechada de restauración integral y smoke de sólo lectura; volumen de archivos externos aclarado por separado. No se ejecutó porque este alcance no autoriza acceso autenticado a proveedores ni operación sobre backups reales.
- Responsable: operaciones + backend/datos. Esfuerzo técnico: 1–2 días una vez provisto el entorno; capacidad/costo es una dependencia externa.

### PP-08 — P2 / confianza alta: cuarentena protege ownership pero desaparece de la experiencia de recuperación

- Evidencia: `frontend/src/offline/db.ts:42` preserva filas legacy como quarantined; `frontend/src/offline/useSyncQueue.ts` sólo cuenta pending/syncing y failed; `SyncQueueView.tsx` muestra estado vacío si ambos son cero. `docs/audits/AUDIT-OFF-REMEDIATION-2026-08-13.md:20` deja recuperación guiada fuera de entrega y reconoce la ausencia de UI.
- Disparador: dispositivo actualizado de Dexie v1–v3 con ventas pendientes sin tenant verificable. La migración conserva las ventas correctamente, pero la cola puede decir que no hay pendientes aunque exista información por recuperar.
- Impacto: el dueño no sabe que debe pedir ayuda y esa venta puede no llegar nunca al ledger. No es pérdida física demostrada ni motivo para asignar automáticamente el tenant actual.
- Cambio mínimo: aviso neutral de registros locales que requieren recuperación, sin exponer contenido ni importar a un tenant no probado; runbook con comprobación de ownership y reconciliación controlada. Si se demuestra que ningún piloto tuvo esos builds/filas, puede bajarse prioridad, manteniendo prueba de upgrade.
- Aceptación: migrar base antigua con pendientes y confirmar aviso/escala segura, preservación íntegra y ninguna lectura cruzada de payload.
- Responsable: frontend/offline + soporte. Esfuerzo: 1–2 días para aviso y procedimiento acotado.

## Claims públicos y producto

Se revisaron mediante GET público la [landing](https://kovasuite.com/), [seguridad](https://kovasuite.com/seguridad), [privacidad](https://kovasuite.com/privacy) y [términos](https://kovasuite.com/terms). Privacidad falló en el lector web, pero respondió HTTP 200 mediante Invoke-WebRequest; el error del lector no se reporta como caída del sitio.

| Claim | Implementación / prueba inspeccionada | Garantía que falta |
|---|---|---|
| Offline en caja preparada | IndexedDB tenant-scoped, catálogo, UUID estable, leases; tests de cola y sync | Cold start real, continuidad durante actualización y reintento agotado: PP-01/02/03 |
| Separación lógica de negocio | Backend usa membership de sesión; colas comprueban ownership local | Coherencia entre cookies globales y estado por pestaña: PP-04 |
| Respaldo diario, siete días | Workflow versionado y runbook | Estado efectivo más reciente del proveedor y restore integral: PP-07 |
| Sin SLA durante beta | Landing, seguridad y términos lo explicitan | Capacidad real de respuesta/incidentes e inbox de soporte no verificados aquí |
| Registro de dinero de mostrador, sin procesamiento bancario | Métodos manuales y separación del cobro SaaS claramente comunicados | Evitar que un reintento cambie el ledger: PP-05 |
| Datos y privacidad | Documentación publica inventario de datos y derechos | Pedidos añaden nombre/teléfono/dirección de entrega (`backend/app/customer_orders/schemas.py:36`); inventario público no los enumera expresamente. Revisar su alcance con responsable legal; no se emite conclusión de cumplimiento normativo |

La jerarquía de mensajes del sitio es concreta y adecuada al SMB mexicano. Prioridad comercial: confiabilidad del cobro, recuperación comprensible y soporte antes de ampliar catálogo de funciones. No se recomienda una reescritura visual ni se presenta aquí un dictamen de accesibilidad visual: no se hizo recorrido renderizado móvil/escritorio en este subalcance.

## CI, infraestructura, observabilidad y dependencias: controles y límites

- CI ejecuta lint/typecheck, contrato API, tests unitarios, mocked E2E, integración real con PostgreSQL y axe, auditoría de dependencias runtime, gitleaks y build reproducible/SBOM antes de release. No se duplicaron los checks globales que ejecuta el coordinador.
- `frontend/e2e/accessibility.spec.ts:31` filtra axe a severidades serious/critical; eso es un gate útil, no certificación WCAG completa. Incluye rutas operativas, pero sólo un modal de apertura de turno en el caso llamado modales financieros. Teclado, lector de pantalla y otros modales requieren su QA específico.
- Migración up→down→up en DB vacía (`ci.yml:264`) prueba reversibilidad estructural; no preservación de datos reales ni compatibilidad de backend viejo con schema nuevo. Fly aplica migraciones antes de actualizar imagen, por lo que el solapamiento de versiones merece pruebas acotadas cuando cambien contratos/schema.
- `backend/fly.toml` configura HTTPS, máquina siempre activa, región dfw y mínimo 1 máquina; no declara checks HTTP de readiness. No se infiere de esto el número efectivo de máquinas ni su salud actual. Hay health externo postdeploy, que actúa después de empezar a servir el backend nuevo.
- Backend base y uv están fijados por digest; frontend usa lockfile/npm ci. El trabajo de reproducibilidad genera SBOM sobre una imagen local que Fly después reconstruye remotamente: SHA de código consistente no demuestra identidad de digest desplegado. Mejorar promoción por digest cuando el riesgo operacional lo justifique, sin introducir plataforma nueva.
- Sentry frontend tiene release, tenant/user IDs y `sendDefaultPii=false`; `tracesSampleRate=0`. Esto permite correlación de errores, no demuestra cobertura de todas las excepciones, redacción exhaustiva ni alertas entregadas. UptimeRobot y DNS/inbox deben verificarse con evidencia de proveedor antes de cerrar gates; no se consultaron herramientas autenticadas.
- Performance: prerender, fuentes locales, lazy chunks para charts/offline/observabilidad y posposición del precache reducen trabajo inicial. No se midieron CWV de campo ni latencia p95; no se inventan presupuestos o resultados. El coordinador registra build actual y checks globales.
- `docs/current-sprint.md` conserva foco/fechas de julio junto con gates y entregas de agosto; los bloques marcados completos no reemplazan estas pruebas de interacción. Conviene enlazar este inventario a un solo backlog y conservar las evidencias históricas como tales.

## Plan acotado

| Fase | Trabajo / responsable | Dependencias | Salida verificable |
|---|---|---|---|
| Días 1–3 | PP-02 presupuesto manual; PP-05 clave de devolución; PP-01 recarga segura. Frontend/POS | Casos reproducibles y builds SW locales | Regresiones sobre implementación; cola se recupera, devolución única, carrito intacto |
| Días 3–7 | PP-04 coherencia de sesión y PP-03 política offline. Auth/API/frontend | Decisión explícita de identidad offline y contrato expected-tenant | Dos pestañas reales, corte completo de red, reinicio y conciliación de ledger |
| Semana 2 | PP-06 release por fases; PP-08 recuperación legacy. Plataforma/soporte | Entorno desechable, ownership seguro | Simulaciones de fallo y upgrade con aviso, sin alterar producción |
| Gate paralelo antes de expansión | PP-07 restore, inbox soporte, Stripe test end-to-end. Operaciones | Capacidad/autorización específica de proveedor y entorno | RTO/RPO y evidencias reales; lo no probado continúa abierto |

No agregar microservicios ni dependencias nuevas para estos defectos. Priorizar invariantes de operación y pruebas de escenarios completos sobre más checks que vuelvan a comprobar helpers aislados.
