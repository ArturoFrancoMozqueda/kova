# Estado funcional de Kova y orden de cierre

Fecha: 22 de octubre de 2026, America/Mexico_City. Base: `02ca589f149f`.

Kova tiene un núcleo POS operativo y varios módulos comerciales internos implementados.
Las principales brechas están en conectar proveedores y completar el recorrido externo.
Un CI aprobado acredita sus controles de código y publicación; no acredita cobros con terminal,
mensajes entregados, timbrado fiscal ni compatibilidad física.

## Qué se verificó y qué significa cada estado

- **Operativo**: implementación respaldada por contratos/pruebas y lectura autenticada del módulo.
  No significa que todas sus acciones se hayan repetido hoy en producción.
- **Interno / alcance limitado**: funciona la parte descrita; falta el resultado externo o una
  integración para que cumpla una expectativa más amplia.
- **Por conectar**: la cuenta o el despliegue no tienen la integración disponible. Puede existir
  adaptador; no se declara que baste con agregar credenciales.
- **Condicionado**: depende de permisos, plan, configuración o dispositivo.

Se recorrieron las vistas principales del propietario en Sweet Home sin crear ventas, modificar
inventario, activar reglas, enviar invitaciones, aceptar permisos de IA ni conectar proveedores.
Se esperó el contenido después de los esqueletos de carga; el encabezado por sí solo no fue evidencia.
La revisión contrasta UI, rutas/backend, specs, pruebas y la aceptación productiva documentada
del 10 y 21 de octubre. No se repitieron hoy las operaciones financieras de esas pruebas anteriores.

## Matriz por sección

| Sección | Estado | Qué hace de verdad / límite que falta cerrar |
|---|---|---|
| Panel | Operativo | Ventas reales del periodo, señales de inventario, accesos operativos y estados sin datos. Hoy sin ventas; no representa ausencia de historial. |
| Caja | Operativo | Catálogo, carrito, modificadores, cliente, descuentos/impuestos, efectivo y registro manual de tarjeta/transferencia/dividido. Venta/refund/void y stock cuentan con QA productiva previa. Registrar tarjeta no procesa el cargo. |
| Ventas y detalle | Operativo | Consulta, filtros, recibos, anulaciones y devoluciones bajo permisos. No se ejecutaron nuevas devoluciones en esta auditoría. |
| Turnos | Operativo; pendiente operativo | Apertura, movimientos, arqueo e historial. La UI muestra un turno abierto hace 12 días; requiere conteo físico y cierre por el negocio. |
| Pedidos | Operativo | Preparación, entrega, cobro y reserva explícita de stock. La cuenta tiene pedidos entregados y cancelados. Aceptar cotización crea pedido, no cobra automáticamente. |
| Productos y categorías | Operativo | Alta/edición, fotos, precios, categorías, importación y modificadores. Hay productos activos con prefijo QA y varios sin costo: revisar higiene del catálogo y costos. |
| Inventario | Operativo | Existencias, reservas, ajustes, conteos, umbrales, historial y lotes. Hoy tres alertas de stock bajo. No descuenta ingredientes mediante recetas/KDS. |
| Compras y proveedores | Operativo | Proveedores, compras pendientes, recepción parcial/total y cancelación; entrada de stock al recibir. No envía pedidos al proveedor ni paga compras. |
| Reposición | Interno / alcance limitado | Sugerencias con stock, reservas, mínimos y compras pendientes; prepara compra revisada. En esta cuenta faltan costos para seleccionar los productos señalados. No compra autónomamente. |
| Clientes | Operativo | Registro, edición, desactivación, compras y vinculación explícita. Teléfono/correo no equivalen a consentimiento comercial. |
| Catálogo público | Operativo; mejora en esta rama | Productos seleccionados, fotos/precios/disponibilidad, QR, enlace WhatsApp y solicitudes públicas. No es checkout/pago en línea. URL legible implementada aquí; aún no publicada. |
| Solicitudes del catálogo | Operativo | Captura pública y cola privada; el equipo elige cliente al convertir a oportunidad. Recorrido validado en producción el 21 de octubre. |
| CRM | Interno / alcance limitado | Oportunidades, responsable, próxima acción y consentimiento por finalidad. Ganar oportunidad no registra ingresos ni envía mensajes. |
| Cotizaciones | Operativo | Precios acordados, vigencia, aceptación registrada por el equipo y pedido vinculado; recorrido hasta venta. Compartir y confirmar aceptación sigue siendo una acción humana. |
| Bandeja | Interno / alcance limitado | Conversaciones internas, asignación, pausa, cierre y borradores. No hay conversaciones externas de WhatsApp/correo entrando en producción. |
| Postventa y seguimiento | Interno / alcance limitado | Política opt-in y tareas de reseña/recompra/incidencia respaldadas por ventas reales. Regla desactivada en la cuenta. Completar tarea no entrega mensajes. |
| Atención postventa | Interno / alcance limitado | Incidencias, responsable, vencimiento, notas, resolución e historial. Resolver no devuelve dinero ni modifica pedidos automáticamente. |
| Pendientes del negocio | Operativo, lectura | Reúne consultas acotadas de atención, CRM, seguimiento y recordatorios. Acciones en el módulo de origen; no es un ejecutor universal. |
| Agenda | Interno / alcance limitado | Recursos de capacidad uno, zona horaria, citas, reprogramación, cancelación e historial. Sin recursos configurados hoy. Recordatorios internos; sin reserva pública, aviso entregado ni cobro de cita. |
| Lealtad | Interno / alcance limitado | Política opt-in, acumulación por ventas, reversas y ledger de canjes. Sin política configurada hoy. El canje no aplica descuento POS ni acredita entrega del beneficio. |
| Automatizaciones | Interno / alcance limitado | Reglas/eventos crean tareas internas y conservan estado. Cero reglas activas en la cuenta. Ejecución programada depende también de cohorte/configuración; no envía ni mueve dinero. |
| Conciliación | Interno / alcance limitado | CSV en formato Kova, sugerencia y confirmación de vínculos con pagos registrados. Sin importaciones hoy. No es conexión bancaria ni adquirente de tarjetas. |
| Análisis | Operativo; dependiente de datos/plan | Ventas netas, devoluciones, productos, sucursales y reposición con datos reales. Hoy muestra vacío legítimo y datos insuficientes para estimar demanda. Margen requiere costos y acceso habilitado. |
| Gastos | Condicionado | Implementación y pruebas existen; esta cuenta muestra “Gastos no está disponible” por acceso a reportes de margen. No habilitarlo saltándose el plan. |
| Asistente | Condicionado / IA por conectar | UI, historial, respuestas locales y herramientas con gates existen. Hoy muestra “IA sin conectar” y consentimiento pendiente; no se ejecutó una nueva consulta. La aceptación previa no prueba proveedor disponible hoy. Documentos, cambios y correo tienen flags/permisos propios. |
| Suscripción | Operativo, proveedor no probado hoy | La cuenta muestra suscripción activa y evita checkout duplicado. Stripe gestiona suscripción SaaS, no cobros de compradores. No se inició checkout, cancelación ni cargo real en esta auditoría. |
| Perfil / logo / formato | Operativo | Perfil, logo, idioma es-MX, MXN y zona horaria persistentes. Revisar teléfono de soporte de apariencia provisional visible en la cuenta. |
| Sucursales y traspasos | Operativo / condicionado | Contexto y acceso por sucursal; transferencias online con reservas protegidas. Sólo una sucursal configurada; no se creó otra para probar. |
| Empleados | Operativo / entrega condicionada | Roles, invitaciones y desactivación con restricciones. No se envió invitación ni se acreditó entrega de correo hoy. |
| Recibos / cajón | Condicionado | Ajustes de recibo y conector de cajón implementados. Requiere hardware/red compatibles y prueba física; no acreditada en esta revisión. |
| Cierres para contador | Operativo | Vista previa, agrupación y evidencia contable congelada; periodos guardados visibles. No son CFDI ni validación SAT. |
| CFDI e integraciones | Por conectar | Datos fiscales, solicitudes, onboarding administrado y adaptador existen. Cuenta muestra CSD/autorización/emisión Live pendientes y activación no disponible. Completar plataforma/PAC y emisor, después prueba Test y aceptación Live autorizada. |
| Terminal bancaria | Por conectar / desarrollo de integración | La UI declara sin conectar. Requiere proveedor y terminal compatibles, estados/webhooks/idempotencia y aceptación de cargo/devolución; tarjeta manual POS no lo sustituye. |
| Canales WhatsApp | Por conectar / desarrollo de integración | Página y API de readiness devuelven checklist estático, no diagnóstico del tenant. Hay adaptador, dominio/outbox y pruebas, pero no webhook público ni dispatcher externo activado. |
| Correo / Instagram | Pendiente de recorrido comercial externo | No hay bandeja omnicanal operativa acreditada. Correo transaccional de acceso o del asistente es otro alcance y requiere configuración/entrega verificadas. |
| Cola offline / PWA | Operativo, dispositivos pendientes | Cola vacía hoy; contratos de reintento/idempotencia y venta offline con QA previa. No se cortó la conexión en una caja productiva durante la auditoría. Safari/iOS y conflictos con equipos físicos requieren aceptación propia. |
| Acceso / onboarding | Implementado, no reejecutado hoy | Sesión autenticada vigente, roles, recuperación/verificación/invitación y gates con pruebas. No se hizo alta, reset ni entrega de correo reales durante este recorrido. |
| Datos de cuenta / soporte | Implementado, no ejecutado hoy | Exportación y solicitud de eliminación con controles; ayuda disponible. No se descargó información privada ni programó eliminación. |
| Landing / catálogo público / legales | Implementados | Rutas públicas y protección de rutas privadas cubiertas en la aceptación y CI. No se declara auditoría legal ni accesibilidad exhaustiva de toda combinación de dispositivo. |
| Operación interna Kova | Fuera del recorrido del comercio | Herramientas administrativas privadas, backups y release con pruebas/evidencia propia. No se asumió acceso interno por ser propietario de Sweet Home. |

## Orden recomendado para terminar

No se detectó hoy un nuevo bloqueo P0 de venta en la revisión de lectura. La desalineación del
release anterior quedó resuelta por #258/#259; eso no elimina las brechas de producto anteriores.

| Prioridad | Entrega concreta | Criterio para darla por terminada | Dependencia |
|---|---|---|---|
| P1 · inmediato | Enlace de catálogo con nombre del negocio | Migración poblada, colisiones/sucursales, QR antiguo, revocación, billing, permisos y solicitud pública probados; CI y release protegido aprobados; URL real verificada. | Cambio de esta rama; autorización final de publicación. |
| P1 · operación | Sanear turno, costos y catálogo activo | Negocio cuenta efectivo y cierra turno; define costos reales; revisa productos QA activos y datos de soporte. | Decisiones/datos del propietario; no inventar importes ni borrar historial. |
| P1 · claridad | Convertir Canales en configuración verificable | Estado real por negocio, requisitos accionables, progreso persistente, errores concretos y sin afirmar conexión antes de confirmarla. | Contrato de configuración y flujo de Meta elegido. |
| P1 · recorrido externo | Conectar WhatsApp de extremo a extremo | Elegibilidad/coexistencia aprobada; binding seguro, webhook HTTPS, firma/dedupe, envío explícito, recibos y revocación; mensaje real enviado/recibido sin duplicados. | Cuenta/número del negocio, configuración de plataforma y consentimiento. No basta con introducir una llave. |
| P2 · asistente | Resolver disponibilidad actual de IA y aceptar recorrido | Proveedor saludable, consentimiento explícito, respuesta con datos autorizados y consumo acotado; documentos/cambios/correo probados por separado si se habilitan. | Configuración del proveedor y aceptación del propietario. |
| P2 · fiscal | Completar CFDI administrado | Plataforma/PAC, requisitos del emisor, Test válido y luego emisión/cancelación Live autorizadas; errores/reintentos recuperables. | Credenciales/certificados y proceso fiscal del emisor. |
| P2 · pagos | Elegir e integrar terminal/PSP | Cobro y devolución reales, estados inciertos, webhook firmado, idempotencia y conciliación comprobados. | Proveedor/hardware y aprobación financiera. |
| P2 · activación interna | Poner agenda, postventa, lealtad y reglas a producir utilidad | Configuración real, roles/cohorte y una operación completa por módulo; responsables claros. Para lealtad decidir cumplimiento manual o integración explícita con POS. | Reglas de negocio del propietario; canales externos para avisos. |
| P2 · aceptación | Cerrar dispositivos y escenarios de falla | Safari/iOS, impresora/cajón, QR físico, reconexión/offline y restauración conforme a release checklist. | Dispositivos reales y ambiente de prueba. |
| P3 · después | Correo/Instagram comercial y banco automático | Proveedor, contratos, permisos, eventos y entrega/conciliación real verificados. | Priorizar según clientes; no ofrecer como disponible hoy. |
| P3 · nuevos productos | Crédito, recetas/KDS, voz, firma, cursos, franquicias | Definir alcance, modelo de datos, seguridad y aceptación antes de implementar. | Roadmap por giro; no son defectos del POS actual. |

## Fuentes y comprobaciones de este cambio

- [Aceptación productiva del POS](KOVA-SWEET-HOME-PRODUCTION-ACCEPTANCE-2026-10-10.md),
  [circuito comercial](KOVA-E2E-COMPLETION-2026-10-18.md),
  [agenda/lealtad](KOVA-E2E-OPERATIONS-2026-10-19.md),
  [atención](KOVA-SERVICE-CASES-2026-10-19.md) y [sprint vigente](../current-sprint.md).
- Inventario de rutas: `frontend/src/App.tsx`; navegación y permisos: `layout/AppShell.tsx`.
- Límites de canales: `backend/app/messaging/readiness.py`, `router.py`, `service.py`,
  `whatsapp.py`; `specs/integrations/messaging-inbox.md` y `provider-readiness.md`.
- URL: `storefront/links.py`, `router.py`, migración `0093_readable_catalog_links`;
  sin cambiar la proyección pública, cookies, gates comerciales ni RLS de productos/clientes.
- Comprobaciones locales: resultados finales se registran en el PR. La rama no acredita por sí
  sola publicación ni una conexión externa; no se modificaron esas cuentas durante la revisión.
