# Experiencia unificada y continuidad del negocio

Fecha: 25 de octubre de 2026. Corte local sobre `main`, HEAD de referencia `ae16805a`, con cambios sin commit. No es un identificador de despliegue.

## Resultado

Se adoptó un lenguaje común de interacción en las áreas donde la auditoría detectó divergencias: controles, etiquetas/foco, encabezado con acción principal, estados vacíos, filtros por teclado y prioridad del trabajo diario sobre configuración. Se corrigió la contradicción de alertas detectada en la [aceptación productiva anterior](KOVA-COMPUTER-USE-E2E-2026-10-25.md).

La aceptación local comprobó mediante UI el circuito **menú público → solicitud → cliente explícito → oportunidad → cotización → pedido → reserva → cobro manual → preparación → entrega → postventa**, seguido de **reposición → compra aprobada → recepción parcial y total**. También pasaron los recorridos existentes cliente/cita/venta a 390/1440 px y cliente/pedido/venta.

El circuito interno probado funciona. Los proveedores externos permanecen sujetos a su propia configuración/aceptación. La suite unitaria completa conserva dos fallos preexistentes del entorno de pruebas de identidad: no se declara toda la suite verde ni el corte listo para publicación.

## Trabajo de Agent Teams

- **UI y consistencia:** auditoría de patrones compartidos; adopción de controles y acciones comunes en atención, agenda, bandeja y seguimiento; regresiones visuales y de foco.
- **Continuidad:** navegación comercial por etapa, enlaces a registros exactos y paso reposición/compra/recepción; prioridad de operación en Compras.
- **Reportes y QA:** severidad de devoluciones coherente, prueba nueva del ciclo real y diagnóstico separado de los fallos de `AbortSignal`.
- **Integración principal:** filtros de Pedidos, nomenclatura de cobro, marco offline, CI del recorrido nuevo, build y validación integrada con API/PostgreSQL/RLS locales reales.

Los cambios previos de WhatsApp/menú/backend presentes al iniciar se conservaron. No se editaron APIs, migraciones, permisos, sesiones ni cálculos financieros para esta unificación. No se desplegó ni se operó sobre el tenant productivo durante este corte.

## Cambios de experiencia

| Área | Cambio y efecto para el negocio |
|---|---|
| Agenda, Atención postventa, Seguimiento, Bandeja | Reutilizan Input/Select/Label/Textarea, con IDs únicos, validaciones originales y foco común. CTA principal en encabezado, panel asociado con aria-controls/expanded y vacíos que no se confunden con carga/error. |
| Borradores de atención y agenda | Plegar y reabrir conserva lo escrito. Agenda conserva además recurso/horarios de la cita nueva; guardar limpia el formulario y pasar de edición a una cita nueva descarta explícitamente el contexto de edición. Regresiones de componente y navegador verifican que plegar no escriba ni pierda datos. |
| Compras | Compras existentes y recepción antes que altas. Preparar compra y Nuevo proveedor abren paneles secundarios; plegarlos o cambiar de panel conserva los borradores. |
| Pedidos | Filtro de estados con SegmentedControl: selección por flechas/Home, una parada de Tab y reinicio de paginación. El contenido conserva su contrato. |
| Cobro de Pedidos | “Tarjeta manual” coincide con Caja, también en pago dividido. Seleccionar método no ejecuta un cobro. Select compartido. |
| Seguimiento | Ver cliente y Ver venta conservan identificadores exactos; no se inventa vínculo de venta cuando falta y los enlaces se ocultan offline. |
| Continuación comercial | Solicitudes → seguimiento → cotizaciones → revisión de pedidos. El enlace general ya no crea un pedido independiente desde Cotizaciones; la conversión sigue dentro del registro. |
| Cotización | Ver seguimiento abre la oportunidad exacta, sólo si existe origen. |
| Reposición | Conserva la compra devuelta por la aprobación y abre `?purchase_id=…`. Compras enfoca/resalta ese registro y lo conserva al recargar; la recepción sigue siendo explícita. Si queda fuera de la página/sucursal actual, comunica el límite sin seleccionar otra compra. |
| Estado offline administrativo | Mantiene el marco y encabezado compartidos, sin montar consultas o mutaciones privadas. |
| Análisis | Recomendación y detalle comparten criterio de severidad. Una devolución del 100% muestra “Revisa esta devolución”; reconoce que un caso no acredita una tendencia. Una devolución única pequeña sigue sin generar alarma. |

Se documentó el [contrato de experiencia](../claude/ui-experience-contract.md) y se enlazó desde las reglas de frontend para prevenir nuevas divergencias. Caja y el menú conservan sus tareas especializadas; esta entrega no rediseña indiscriminadamente todos los módulos.

## Prueba real del proceso completo

Nueva prueba: `frontend/e2e/business-lifecycle-real.spec.ts`, incluida en `test:integration` para que CI repita la aceptación.

Se ejecutó sobre el build cliente/SSR/prerender y un stack efímero local: FastAPI en 8009, preview en 5174 y PostgreSQL en 55459. La API usó el rol runtime `kova_app`, sin superusuario ni bypass RLS; el arranque verificó RLS sobre 92 tablas runtime. Las migraciones existentes y grants se aplicaron sólo a una base local nueva. No se leyó configuración secreta de producción para prepararla.

Después de preparar maestros y verificar la cuenta local, todas las acciones comerciales bajo prueba se ejecutaron con clicks/formularios. APIs se usaron después para lecturas de comprobación, sin sustituir confirmación, cobro, entrega ni recepción por escrituras directas. El cliente del menú abrió un contexto anónimo independiente a 390 px. El test exige localhost y `KOVA_INTEGRATION=1`.

| Paso | Comprobación real |
|---|---|
| Publicación y solicitud | Publicación por UI; selección de dos unidades a $45; solicitud por $90 llega al tenant. Stock físico 5, reserva 0, sin ventas. |
| Identidad y propuesta | Revisión vincula cliente explícito; oportunidad y cotización conservan origen y cliente. Compartir/aceptar son registros internos revisados, sin envío externo. |
| Pedido nuevo | Aceptar crea pedido vinculado por $90 sin cobro y todavía sin reserva. |
| Confirmación | Stock 5, reserva 2 y disponible 3. |
| Cobro | Transferencia manual por $90; una venta vinculada al pedido/cliente. Stock 3 y reserva 0. El journey declara `external_collection_verified:false`. |
| Entrega | UI registra preparación → listo → entregado; conserva venta, fecha de entrega y stock 3. |
| Postventa | Ficha muestra pedido/venta. Atención vinculada a cliente/venta se resuelve sin devolver dinero ni alterar el registro de venta. |
| Compra aprobada | Reposición crea compra de cuatro unidades a $12.50, total $50. Abrir compra conserva el UUID y foco. Stock sigue 3 hasta recibir. |
| Recepción parcial | Recibir una unidad deja compra parcial y stock 4. |
| Recepción total | Recibir las tres restantes deja compra recibida y stock 7; recargar conserva cantidades y una sola venta de $90. |

Además, `connected-owner-real.spec.ts` aprobó tres casos: cita/venta en escritorio, cita/venta móvil y pedido/venta con identidad, reservas e historial. Los cuatro recorridos reales se repitieron y aprobaron tras incorporar el ajuste final de Compras.

## Validación

| Comprobación | Resultado |
|---|---|
| Ciclo real + comercio/servicios reales existentes | **4/4 aprobados** sobre el build final, también después de corregir la conservación del borrador de cita. |
| Regresiones de navegador con APIs declaradas/interceptadas | **47/47 aprobadas**: 30 de engagement/CRM/Pedidos/Atención, 9 de continuidad/expansión POS y 8 de anatomía compartida. No acreditan proveedores externos. |
| Tamaños | Regresiones relevantes cubren 320/390/768/1440 px; suite nueva de consistencia cubre 390/1440. |
| Foco y visual | Etiquetas, foco, apertura/cierre sin escrituras y ausencia de overflow. Capturas de Agenda, Bandeja y Compras inspeccionadas en móvil/escritorio. |
| Unitarias completas | **1,407 aprobadas, 2 fallidas, 195 archivos**. Las dos fallidas son las preexistentes de identidad descritas abajo. |
| TypeScript y ESLint completos | Aprobados, incluyendo las nuevas specs. |
| Build cliente + SSR + prerender | Aprobados. Advertencia existente de chunk circular vendor/vendor-react; no se hizo refactor del bundle. |
| OpenAPI crítico, guard E2E y escaneo de secretos en bundle | Aprobados: 55 specs y 124 JS verificados. |
| `git diff --check` | Aprobado. |

Las pruebas nuevas de consistencia tuvieron una primera ejecución con selectores incorrectos: el CTA cambia de nombre al abrir y el texto DOM del label envuelve opciones de Select. Se contrastaron los nombres accesibles reales y se corrigieron los selectores conservando las aserciones de etiqueta/foco, no se cambió la implementación ni se quitaron verificaciones para acomodarlos.

### Fallos preexistentes de identidad

`AuthContext.identity.test.tsx:579` y `:607` fallan al construir `new Request(..., {signal})`, antes de ejecutar el fetch de Kova. Entorno instalado: Node 24.19.0, Vitest 3.2.7, jsdom 25.0.1.

El diagnóstico independiente, sin importar Kova, reproduce el TypeError al combinar Request nativo de Node con AbortController de jsdom; el par nativo conserva cancelación. Vitest mezcla esos constructores en este entorno. `--pool=threads` mantiene los dos fallos; `--pool=vmThreads` impide colección por interoperabilidad ESM/CJS. El sprint ya documentaba esos dos errores antes de este corte.

No se modificaron auth, fixtures, expectativas, dependencias ni harness para ocultarlos. Las dos garantías de cancelación durante refresh siguen sin acreditarse por esa suite; el gate de unitarias completas permanece pendiente para release.

## Archivos de este corte

- Componentes: nuevo `components/ui/textarea.tsx`; `automations/workspace.tsx` y su regresión en AutomationsView.
- Operación/atención: AppointmentsView y su test, ServiceCasesView, FollowupsView, InboxView y EngagementViews.test.
- Comercio: CustomerOrderListView/CustomerOrderCheckoutRegister y pruebas; BusinessNextActions y pruebas; aserción contextual de AppShell.navigation; QuotesView y pruebas.
- Abastecimiento: PurchasingView/ReplenishmentView y pruebas.
- Decisión: recommendations, sus tests, ReportsView.test y dos claves de i18n.
- Navegador: nuevas business-lifecycle-real, business-continuity, experience-consistency; apertura legítima de paneles en pos-expansion y etiqueta Tarjeta manual en connected-owner-real. No se debilitaron payloads ni resultados esperados.
- Validación continua: `frontend/package.json` incluye el ciclo real en integración.
- Documentación: este informe, contrato UI/UX, enlace en `.claude/rules/frontend.md` y sección de sprint.

Las diferencias adicionales de backend, storefront, WhatsApp y OpenAPI que ya existían en el checkout no pertenecen a esta entrega.

## Evidencia visual

En `output/qa/experience-2026-10-25/`: `01` menú real móvil; `02` postventa real; `03` compra real recibida; `04` cliente/servicio móvil; `05/06` Agenda móvil/escritorio; `07` Bandeja móvil; `08/09` Compras escritorio/móvil. Las últimas cinco son composiciones con respuestas interceptadas y datos de prueba; las cuatro primeras proceden del stack real local efímero.

![Compras: operación primero y registro exacto](../../output/qa/experience-2026-10-25/08-compras-desktop.png)

## Límites de aceptación

El proceso interno probado no acredita WhatsApp/Meta entregado, cobro de tarjeta o transferencia por un PSP, CFDI Test/Live, campañas, pago a proveedor ni conciliación externa automática. Tampoco se hizo nueva QA productiva, publicación, hardware físico, VoiceOver, impresora o corte de red físico. Servicios especializados conservan sus propios contratos; no se añadió contabilidad completa ni funciones no existentes para presentar una certificación general del negocio.

La entrega queda local y revisable. Pendientes para publicación: resolver el gate de las dos pruebas preexistentes y ejecutar los gates de release del repositorio; los proveedores requieren configuración/aceptación explícita aparte. No se alteraron datos productivos para esta implementación.
