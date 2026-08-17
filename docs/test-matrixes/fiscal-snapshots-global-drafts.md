# Matriz de pruebas: snapshots fiscales y borradores globales

Estado: criterios de aceptación para la épica 05. Este alcance conserva evidencia interna de venta y
permite cerrar **borradores internos** por periodo. No emite, timbra, cancela ni representa un CFDI;
no genera XML ni integra un PAC. El reporte para contador puede invocar la impresión del navegador,
pero Kova no genera ni persiste archivos PDF.

## Invariantes bloqueantes

- La venta, sus partidas, pagos, inventario y snapshots se confirman o revierten en una sola
  transacción.
- Producto, nombre, precio, configuración y versiones futuras nunca reescriben una venta anterior.
- `Decimal`/`NUMERIC` y `ROUND_HALF_UP`; ningún cálculo monetario usa `float`.
- Timestamps persistidos en UTC; los límites de periodo se interpretan en
  `America/Mexico_City`.
- Un borrador sólo incluye ventas completadas del tenant y del periodo que aún no estén asignadas a
  otro borrador ni marcadas para atención individual.
- La misma clave idempotente y el mismo cuerpo producen el mismo cierre; misma clave con cuerpo
  diferente produce conflicto. Cierres concurrentes no duplican ventas.
- El feature flag `fiscal_global_drafts` controla rutas y UI de borradores; no controla la captura
  interna de snapshots.
- Tenant y permisos se resuelven desde la sesión. IDs ajenos responden `404`; permisos insuficientes
  responden `403`.
- Toda copy identifica `recibo operativo`, `borrador interno`, `no emitido` y
  `Borrador interno · No es CFDI`; nunca atribuye emisión, timbrado, UUID fiscal, XML o PAC. La acción
  `Imprimir o guardar como PDF` sólo abre la impresión nativa del navegador.

## Matriz negativa y de bordes

| ID | Área | Preparación / acción | Resultado esperado | Nivel |
|---|---|---|---|---|
| FS-01 | Venta directa | Crear por `POST /orders` una venta gravable | Orden, partidas, pagos, inventario y snapshot existen en el mismo commit | Integración PG |
| FS-02 | Checkout de pedido | Cobrar un `customer_order` usando el servicio compartido de persistencia | El mismo contrato de snapshots que venta directa; no hay una ruta fiscal alternativa | Integración PG |
| FS-03 | Sync histórico | Reproducir una venta offline simple previa a esta épica | Conserva `client_uuid`, hash/idempotencia y respuesta histórica compatible | Integración/BDD |
| FS-04 | Replay offline | Enviar dos veces la misma venta offline | Mismo `order_id`, un orden y una sola historia fiscal | Integración/BDD |
| FS-05 | Conflicto offline | Reusar identidad con payload distinto | Conflicto recuperable; no segunda orden ni snapshot parcial | Integración/BDD |
| FS-06 | Filas históricas | Leer orden anterior con campos fiscales `NULL` | Respuesta compatible: `null`/incompleto, nunca cero inventado ni excepción | API/PG |
| FS-07 | Catálogo mutable | Cambiar nombre, SKU, precio y configuración del producto tras cobrar | Recibo y lecturas históricas conservan snapshots originales | Integración/BDD |
| FS-08 | Eliminación/desactivación | Desactivar producto o configuración tras cobrar | Venta histórica sigue legible y elegible según su propio snapshot | Integración PG |
| FS-09 | Precisión | Bases/tasas con seis decimales y residuos de medio centavo | Agrega en precisión interna y cuantiza cobro `ROUND_HALF_UP` a dos decimales | Unit golden |
| FS-10 | Decimal | Inspeccionar entradas/operaciones y probar valores extremos permitidos | No `float`; overflow o más decimales son rechazados, no truncados silenciosamente | Unit/API |
| FS-11 | Transacción | Forzar excepción al insertar un snapshot | Rollback de orden, partidas, pagos, movimiento, snapshot e idempotencia | Integración PG |
| FS-12 | Tenant API | Tenant B consulta settings/preview/batch de A por ID adivinado | `404`, sin metadatos de A | API/BDD |
| FS-13 | RLS SQL | `kova_app` cambia contexto entre tenants y consulta tablas nuevas | Sólo ve/escribe filas propias; RLS habilitado y forzado | Integración RLS |
| FS-14 | RBAC owner | Owner consulta/actualiza configuración, previsualiza y cierra | Permitido y auditado | API/BDD |
| FS-15 | RBAC manager | Manager usa lecturas permitidas pero intenta cambiar/cerrar sin permiso | Lectura según contrato; mutación `403`, sin cambios | API/BDD |
| FS-16 | RBAC cashier | Cashier intenta settings/preview/close/list/detail | `403` y navegación ausente/deshabilitada | API/E2E |
| FS-17 | Flag apagado | Tenant sin `fiscal_global_drafts` llama rutas y abre ajustes | Rutas niegan/no exponen función según patrón de flags; UI no ofrece control | API/E2E |
| FS-18 | Flag y snapshots | Cobrar con flag apagado | Snapshot interno se persiste: el flag sólo oculta borradores | Integración PG |
| FS-19 | Zona horaria | Venta en `05:59:59Z`/`06:00:00Z` alrededor de medianoche CDMX | Sólo la segunda pertenece al nuevo día local (según offset vigente) | Unit/PG |
| FS-20 | DST histórico | Evaluar límites antes y después de cambios históricos de horario mexicano | Usa IANA `America/Mexico_City`, no offset fijo; sin hora duplicada/perdida | Unit |
| FS-21 | Día | Preview/cierre diario en día sin ventas, con ventas y límite exacto | Intervalo local semiabierto `[inicio, fin)`; vacío explícito, sin venta vecina | Unit/API |
| FS-22 | Semana | Semana que cruza mes/año | Inicio/fin deterministas y misma definición en preview/close | Unit/API |
| FS-23 | Mes | Febrero 2024 y febrero no bisiesto | Incluye 29-feb sólo en 2024; cierra al primer instante del mes siguiente | Unit/API |
| FS-24 | Medianoche | Venta exactamente al final de un periodo | Se incluye una sola vez en el periodo siguiente | Integración PG |
| FS-25 | Rango inválido | Fin anterior/igual al inicio, periodicidad inválida o fecha imposible | `422`, sin batch | API |
| FS-26 | Futuro/incompleto | Intentar cerrar periodo aún abierto o demasiado futuro | Rechazo explícito; no se congela un periodo incompleto | API |
| FS-27 | Solapamiento | Cerrar un periodo que intersecta un batch existente | Conflicto sin modificar batch ni ventas | Integración PG |
| FS-28 | Periodos contiguos | Cerrar dos periodos adyacentes válidos | Permitido; cada venta aparece como máximo en uno | Integración PG |
| FS-29 | Idempotencia | Repetir cierre con misma clave/cuerpo | Mismo status/body/batch; una auditoría efectiva y cero duplicados | Integración PG |
| FS-30 | Hash conflictivo | Misma clave con periodo o configuración distinta | `409`/conflicto; conserva respuesta original | API/PG |
| FS-31 | Concurrencia | Dos transacciones cierran el mismo/solapado periodo | Una gana; la otra conflicto; asignación única verificable | Integración PG |
| FS-32 | Preview race | Venta llega después de preview y antes de close | Close recalcula en servidor y devuelve conteos/importes reales del batch | Integración PG |
| FS-33 | Marker individual | Marcar venta para atención/facturación individual antes del preview | Excluida del borrador global y contabilizada como exclusión | API/PG |
| FS-34 | Marker posterior | Intentar marcar individual una venta ya congelada en batch | Conflicto o flujo compensatorio explícito; nunca doble inclusión | API/PG |
| FS-35 | Refund previo | Venta con devolución parcial anterior al cierre | Borrador usa importes netos derivados de snapshots originales, sin tasa actual | Unit/PG |
| FS-36 | Refund total/void | Venta totalmente devuelta o anulada antes del cierre | Se excluye o refleja como ajuste según contrato, sin sumar venta bruta como vigente | Unit/PG |
| FS-37 | Refund posterior | Devolver/anular después de congelar batch | Batch original no se reescribe; queda ajuste trazable para periodo posterior | Integración PG |
| FS-38 | Estado inválido | Venta pendiente, fallida o no sincronizada | No se incluye; no bloquea ni desaparece de su cola operativa | API/E2E |
| FS-39 | Snapshot incompleto | Venta histórica sin snapshot entra al periodo | Se reporta incompleta/excluida; nunca se inventa impuesto/base | API/PG |
| FS-40 | Batch vacío | Cerrar preview sin ventas elegibles | Rechazo/empty state explícito según contrato; nunca batch engañoso con ceros | API/E2E |
| FS-41 | Falla de commit | Excepción tras asignar algunas ventas y antes de guardar batch | Rollback total: ninguna venta queda huérfana o bloqueada | Integración PG |
| FS-42 | Copy recibo | Mostrar desglose interno en recibo | Encabezado/nota `recibo operativo`; no presenta UUID/estado fiscal | Unit/E2E |
| FS-43 | Copy preview | Configuración, preview, cierre, empty/error/offline/permissions | Sólo `borrador interno`; nunca términos prohibidos de emisión | Unit/E2E |
| FS-44 | Offline UI | Perder red en settings/preview/close | Mutación deshabilitada o error recuperable; venta POS simple sigue disponible | E2E mocked |
| FS-45 | Error API | `401/402/403/404/409/422/500` en cada recorrido | Copy accionable sin filtrar detalles; no conserva éxito optimista falso | Unit/E2E |
| FS-46 | Auditoría | Cambiar settings/cerrar/conflicto | Registra actor, tenant, IDs y categorías; no PII fiscal ni payload completo | Integración PG |
| FS-47 | Cuenta eliminada | Purga de tenant con datos nuevos | Tablas respetan lifecycle y no dejan referencias huérfanas | Integración PG |
| FS-48 | OpenAPI/PWA vieja | Cliente viejo ignora campos nuevos y servidor recibe extras viejos | Contrato expand compatible; venta no se pierde ni se rechaza por campos opcionales | Contract/BDD |
| FS-49 | Scheduler omitido | Un periodo venció mientras el job no se ejecutó y corre después | Catch-up prepara exactamente un borrador del periodo vencido | Integración PG |
| FS-50 | Scheduler duplicado | Dos ejecuciones reciben el mismo periodo/tenant | Una creación efectiva; la otra replay/no-op sin duplicar batch o ventas | Integración PG |
| FS-51 | Catch-up acotado | Hay más periodos vencidos que el máximo por ejecución | Procesa sólo el límite documentado, en orden determinista; la siguiente corrida continúa | Unit/PG |
| FS-52 | Scheduler deshabilitado | Flag o configuración de auto-preparación apagados | Omite el tenant sin cerrar manualmente ni mutar su último periodo | API/PG |
| FS-53 | Endpoint interno | Falta o es inválida la credencial interna del scheduler | `401`/`403`, ninguna enumeración de tenants ni mutación | API/security |
| FS-54 | Fallo por tenant | Un tenant falla entre otros tenants elegibles | Aísla la transacción fallida, continúa/reporta según contrato y el retry no duplica éxitos | Integración PG |
| FS-55 | Copy automático | UI presenta auto-preparación habilitada | Explica que Kova prepara un borrador interno al vencer el periodo y que el owner lo revisa | Unit/E2E |
| FS-56 | Mes corto | Configurar día 31 en febrero, abril, junio, septiembre o noviembre | Usa el último día real del mes; no salta el periodo ni invade el siguiente | Unit/BDD |
| FS-57 | Semana ISO | Configurar cada valor semanal de 1 a 7 | Mapea lunes=1 a domingo=7 de forma determinista y rechaza 0/8 | Unit/API |
| FS-58 | Backfill histórico | Migrar órdenes previas y leer ventas sin snapshot completo | Backfill determinista donde hay evidencia; en lo demás estado incompleto, nunca cero inventado | Migration/PG |
| FS-59 | Inmutabilidad SQL | `UPDATE`/`DELETE` directo sobre snapshots o batch cerrado | La base rechaza la mutación para el rol de aplicación | Integración PG/RLS |
| FS-60 | Referencias tenant | Intentar combinar orden/item/batch de tenants distintos | Constraint/referencia compuesta rechaza la escritura aun fuera de la API | Integración PG |
| FS-61 | Ecuación monetaria | Persistir/leer líneas y orden con descuentos/impuesto | `gross - discount + tax = total`; sumas de líneas reconcilian con orden | Unit/PG |
| FS-62 | Marker no confiable | Cliente incluye `individual_fiscal_status` en venta/sync | Se ignora/rechaza conforme contrato compatible; nunca confirma atención individual desde cliente | API/BDD |
| FS-63 | Export tenant | Tenant B solicita `/batches/{id}/accountant-report.csv` de A | `404`, sin tamaño, filename, filas ni importes del tenant A | API/PG |
| FS-64 | Export RBAC | Owner/manager y cashier/staff solicitan el mismo reporte | Owner y manager descargan; cashier y staff reciben `403` | API/E2E |
| FS-65 | Kill flag | Kill switch resuelve `fiscal_global_drafts=false` en sesión | La ruta/panel no se monta, no hay requests fiscales y el endpoint también rechaza | API/E2E |
| FS-66 | CSV injection | Nombre del negocio/metadata exportable inicia con `=`, `+`, `-`, `@`, tab o retorno | El campo se neutraliza como texto y conserva su valor legible; no ejecuta fórmulas | Unit/security |
| FS-67 | CSV RFC 4180 | Campos contienen coma, comillas, CR/LF y acentos | Escape consistente, comillas duplicadas, filas parseables y UTF-8 | Unit/contract |
| FS-68 | Headers descarga | Descargar un reporte permitido | `text/csv; charset=utf-8`, `Content-Disposition` con filename seguro, `Cache-Control: no-store` y `X-Content-Type-Options: nosniff` | API/security |
| FS-69 | Privacidad | Venta contiene nombre, correo, teléfono, dirección o datos fiscales de cliente | Ninguno aparece en CSV, UI, errores, logs ni filename | API/security |
| FS-70 | Datos congelados | Producto/cliente cambia después del cierre | CSV usa sólo asociaciones y snapshots del batch cerrado; importes reconcilian con su detalle | Integración PG |
| FS-71 | Vacío exportable | Batch histórico válido queda sin filas exportables | CSV conserva BOM/encabezados definidos y cero filas; no inventa datos | Unit/API |
| FS-72 | Descarga UI | Descargar con filename RFC 5987/quoted y después repetir | Usa el filename del header, revoca el object URL y cada clic hace una sola descarga | Vitest/E2E |
| FS-73 | Print UI | Owner/manager imprime reporte compacto | `window.print` muestra únicamente control interno real; no llama endpoint PDF ni persiste blob | Vitest/E2E |
| FS-74 | Offline export | Se pierde red con un reporte ya visible | CSV queda deshabilitado con explicación; impresión local sigue disponible; ninguna falsa descarga | Vitest/E2E |
| FS-75 | Error export | CSV responde `401/403/404/500` o falla la red | Error accionable, sin body técnico/PII y sin toast de éxito falso; reintento disponible | Vitest/E2E |
| FS-76 | Copy contador | Abrir reporte, descarga, error, offline e impresión | Muestra `reporte de control interno`, `recibo operativo`, `no emitido`, `no es CFDI` y que Kova no calcula impuestos hoy | Unit/E2E |
| FS-77 | Configuración ausente | GET de settings para un tenant sin fila persistida | Devuelve `configured=false` y valores iniciales sin escribir ni aparentar configuración guardada | API/PG |
| FS-78 | Owner sin configurar | Owner abre la propuesta inicial | Debe guardarla antes de preview/cierre; al guardar recibe `configured=true` y el último cierre concluido | Vitest/E2E |
| FS-79 | Manager sin configurar | Manager abre la propuesta inicial | Ve estado de sólo lectura que atribuye la configuración al owner; no puede guardar, previsualizar ni cerrar | Vitest/E2E |
| FS-80 | Cambios pendientes | Owner cambia periodicidad o día tras preparar una vista previa | La vista previa se limpia y preview/cierre quedan bloqueados hasta guardar | Vitest/E2E |
| FS-81 | Incidente mensual | Con día 31, hoy 2026-08-16, se intenta 2026-07-16 | Error inline propone 2026-07-31 y no envía request; el servidor también rechaza el desfase | Unit/API/E2E |
| FS-82 | Locale y zona | Repetir el cierre en navegador es-MX y en-US con `America/Mexico_City` | El valor y query permanecen ISO `YYYY-MM-DD`; actual/futuro se evalúa en la fecha local mexicana | Unit/E2E |

## Recorridos Playwright mocked

1. Owner habilitado: ajustes -> periodicidad diaria/semanal/mensual -> guardar -> preview -> revisar
   elegibles/excluidas -> cerrar manualmente -> ver detalle inmutable.
2. Empty: no hay ventas elegibles y se explica sin proponer un documento fiscal.
3. Error recuperable: preview `500`, cierre `409` y reintento idempotente sin doble batch.
4. Offline: lectura visible si está en caché; guardar/cerrar no se simulan; POS conserva venta simple.
5. Permisos: cashier no ve navegación; acceso directo recibe estado de permiso insuficiente.
6. Flag apagado: navegación y requests fiscales ausentes.
7. Copy guard: búsqueda case-insensitive de términos prohibidos en toda la vista y recibo actualizado.
8. Auto-preparación: habilitar/deshabilitar y confirmar que el texto promete preparación del borrador,
   no un documento externo ni una emisión automática.
9. Reporte contador owner/manager: abrir detalle -> reconciliar totales congelados -> descargar CSV con
   filename del servidor -> imprimir con `window.print`.
10. Export negativo: cashier/staff/tenant ajeno/kill flag, descarga `500`, offline, CSV injection,
    privacidad, UTF-8/RFC 4180 y respuesta vacía con encabezados.
11. Configuración ausente: owner guarda la propuesta antes del preview; manager ve por qué no puede
    continuar y ninguna lectura crea configuración implícita.
12. Incidente de fecha: mensual día 31 propone el último cierre concluido; 2026-07-16 muestra error
    inline sin request y la query válida conserva `period_end=2026-07-31` en es-MX y en-US.
13. Configuración pendiente: cambiar frecuencia o día limpia la vista previa y bloquea preview/cierre
    hasta guardar.

## Evidencia requerida para cierre

- Unit/golden de `Decimal`, límites de zona y calendario.
- Integración en PostgreSQL real para rollback, concurrencia, RLS y ambos caminos de venta.
- BDD de inmutabilidad, offline replay, solapamiento, marker individual, refund/void y copy.
- Vitest de API/vista y Playwright mocked de los trece recorridos.
- `ruff`, typecheck, lint y contrato OpenAPI.
- QA manual con una cuenta owner y cashier. La impresión del navegador sí forma parte de esta épica;
  timbrado, PAC, XML, CFDI o generación/persistencia de PDF no forman parte del alcance.
