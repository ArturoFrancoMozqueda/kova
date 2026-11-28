# Backlog competitivo: cafeterías, panaderías y pastelerías

Documento base vivo. Auditoría inicial: 26 de noviembre de 2026, contra `origin/main` `5c9d24c9`.
Reúne el estado verificado de cada capacidad, el backlog priorizado y el punto exacto de
continuación. Si este archivo y el código no coinciden, manda el código; corrígelo en el mismo PR.

Objetivo: que un negocio independiente cobre y cierre caja con confianza, controle insumos,
recetas, producción e inventario, conozca su costo real y prepare/entregue pedidos sin
recapturar. Se busca menos trabajo manual y menos errores, no más pantallas. No cambia precios,
planes ni suscripciones sin decisión del dueño.

## Cómo leer el estado

| Clase | Significado |
|---|---|
| 1 | Existente y verificada (código + pruebas automatizadas; publicación según `current-sprint.md`) |
| 2 | Existente pero incompleta |
| 3 | Implementada; activación o aceptación externa pendiente |
| 4 | Solo especificada |
| 5 | Ausente |
| 6 | Estado desconocido |

Las pruebas automatizadas no acreditan publicación, integración externa ni aceptación de un negocio.
Las afirmaciones sobre Loyverse, Treinta o Colega POS **no están verificadas** en este repositorio;
no se usan como evidencia hasta contrastarlas con fuentes fechadas.

## Auditoría por frente

| Frente | Capacidad | Clase | Evidencia | Próximo paso |
|---|---|---|---|---|
| A | Turnos, entradas/salidas, cierre ciego | 1 | `backend/app/shifts/`, `bdd/test_shifts_*` | Conteo humano ([sales-readiness](runbooks/sales-readiness.md)) |
| A | Efectivo, transferencia, tarjeta manual, pago dividido | 1 | `orders/schemas.py`, `test_split_payment.py` | — |
| A | Descuentos con permiso | 1 | `orders.discount`, `test_order_pricing_controls.py` | Cupones (E8) |
| A | Devoluciones por medio original, anulaciones | 1 | ADR-037, `test_refund_*` | — |
| A | Devolver dinero sin reponer producto | 1 (publicada 26-nov, #391) | `test_refund_restock.py`, [spec](../specs/orders/refunds.md) | Aceptación en un negocio |
| A | Historial, recibo y reimpresión | 1 | `GET /orders/{id}/receipt`; búsqueda por folio/cliente (E8b) | — |
| A | Offline: recarga, reconexión, sin duplicados | 1 | [offline_sync](../specs/orders/offline_sync.md), e2e `offline-sale-real` | — |
| A | Tickets 58/80 mm, cajón, lector | 3 | Impresión del navegador, cajón ESC/POS por red; [matriz](runbooks/pos-hardware-acceptance.md) | Prueba física por modelo |
| B | Productos, SKU, código de barras, modificadores con precio | 1 | `catalog/`, `modifiers/` | — |
| B | Importación CSV/XLSX con vista previa | 1 | ADR-013, `test_catalog_import.py` | Exportación de catálogo |
| B | Costo desconocido distinto de cero | 1 | `products.cost_price` nullable, `order_items.unit_cost` | — |
| B | Insumos no vendibles, unidades y conversiones | 1 (publicada 26-nov, #392) | [ingredients_units](../specs/inventory/ingredients_units.md), `test_ingredients_units.py` | Aceptación en un negocio; recetas (E3) |
| B | Modificador con costo/consumo | 1 (publicada 26-nov, #395) | `modifier_option_consumptions` | Aceptación en un negocio |
| B | Variantes con precio, SKU y existencias propias | 4 | [variants.md](../specs/catalog/variants.md) | Decidir tras pilotos |
| C | Recetas al vender | 1 (publicada 26-nov, #395) | [recipes_on_sale](../specs/recipes/recipes_on_sale.md), `test_recipes_on_sale.py` | Aceptación en un negocio; producción (E4) |
| C | Producción por lote, rendimiento y merma | 1 (publicada 27-nov, #397) | [batch_production](../specs/recipes/batch_production.md), `test_batch_production.py` | Aceptación en un negocio |
| D | Movimientos, ajustes, conteos físicos, mermas tipificadas, lotes | 1 | `inventory/`, ADR-011, [physical-counts](../specs/inventory/physical-counts.md) | — |
| D | Proveedores, órdenes y recepción parcial | 1 | `purchasing/`, Gestión; diferencias con motivo (E8b) | — |
| D | Unidad de compra distinta a la de consumo | 1 (publicada 26-nov, #392) | Factor congelado por partida, recepción convertida | Aceptación en un negocio |
| D | Traspasos entre sucursales | 1 | `branches/transfers.py` | — |
| D | Sugerencias de reposición → compra aprobada | 1 | `replenishment/` | Incluir insumos (E5) |
| D | Cobertura estimada (`days_until_out`) | 2 | `inventory/service.py`, sin prueba propia | E5 |
| E | Costo histórico por partida y margen | 1 | ADR-010, `test_report_margins.py` | Costo por receta (E3) |
| E | Gastos y resultado operativo aproximado | 3 | ADR-012/015, flag `margin_reports` | Activación por negocio |
| E | Merma valorizada | 2 | Usa costo actual; devoluciones sin reponer ya visibles (E1) | Costo histórico por movimiento |
| F | Pedidos con fecha comprometida, apartado y seguimiento | 1 | `customer_orders/`, ADR-014 | — |
| F | Cotizaciones | 1 | `quotes/` | — |
| F | Anticipos, abonos y saldo | 1 | Anticipos con política por negocio (E6) | Uso real del caso integral 3 |
| F | Crédito a clientes | 5 | Diferido | Decisión del dueño |
| G | Cola de preparación / estaciones | 1 | Cola por estación para Caja y pedidos (E7) | Comandas impresas y mesas después |
| G | Mesas y cuentas abiertas | 5 | Solo solicitudes de mesa (ADR-033) | P3 |
| H | Menú QR, catálogo público, seguimiento | 1 | `storefront/` | — |
| H | Checkout en línea y pedidos programados | 5 | El pedido sale por WhatsApp | P2/P3 |
| H | Reparto | 5 | Diferido | P3 |
| I | Clientes, puntos, recompensas y su reversa en devolución | 1 | `loyalty/`, `reward_return` | — |
| I | Alta pública de tarjeta | 3 | Apagada por sucursal | Activación del dueño |
| I | Sellos, cupones, promociones, campañas | 2 | Cupones (E8); sellos y campañas siguen fuera | Uso real de cupones |
| J | CFDI (Facturapi) | 3 | Sin emisor ni Test/Live ([runbook](runbooks/managed-fiscal-onboarding.md)) | E9: emisor del dueño |
| J | WhatsApp oficial | 3 | Bloqueo Meta 3441107 ([expediente](runbooks/whatsapp-meta-app-review.md)) | Aprobación de Meta |
| J | Terminal de pago / Wallet | 5 | Sin proveedor contratado | Decisión y contrato |
| K | Roles fijos, permisos de descuento/devolución/ajuste, sucursales | 1 | `rbac/permissions.py`, `branches/` | — |
| K | Permiso para ver costos, PIN rápido, asistencia | 5 | — | P3 |
| L | Presets por giro, tour, importación, exportación de cuenta | 1–2 | `onboarding/`, `account_lifecycle/` | Asistente inicial por giro |
| M | Panel de control y cola de operaciones | 2 | `reports/control.py`; E5 agrega existencias negativas e insumos sin costo en recetas (publicada 27-nov, #399) | Pendientes de sincronización en la cola |
| M | Asistente con respuestas ancladas | 3 | ADR-017/034 | Corpus y revisión humana |
| 9 | Medición de tareas (venta, pedido, recepción, reposición, producción, cierre de turno) | 1 | `telemetry/useTaskMeasurement.ts`, [task_experience](../specs/reports/task_experience.md); producción y cierre en revisión | — |

## Backlog priorizado

| # | Entrega | Prioridad | Depende de | Estado |
|---|---|---|---|---|
| E1 | Devolución con reposición explícita y merma por devolución valorizada | P0 | — | Publicada (#391, release 45920243100) |
| E2 | Insumos, unidad base (`pza`/`g`/`ml`) y unidad de compra | P1 | — | Publicada (#392, release 45922044316) |
| E3 | Recetas al vender, consumo por modificador y costo por partida | P1 | E1, E2 | Publicada (#395, release 45937609716) |
| E4 | Producción por lote: rendimiento, merma y costo del lote | P1 | E2, E3 | Publicada (#397, release 45941970426) |
| E5 | Panel: insumos bajos → propuesta de compra; productos sin costo completo | P1 | E2–E4 | Publicada (#399, release 46032469644) |
| E8b | Recepción con diferencias; búsqueda de ventas por folio/cliente | P1 | — | Publicada (#402, release 46051884447) |
| E6 | Anticipos y saldo: cotización → anticipo → entrega → liquidación | P2 | — | Publicada (#403, release 46064467636) |
| E7 | Cola de preparación de mostrador | P2 | E3 | Publicada (#405, release 46073577075) |
| E8 | Cupones con vigencia, límites y compatibilidad | P2 | E1 | Publicada (#408, release 46088186882) |
| E9 | CFDI Test | P2 | Emisor del dueño | Bloqueado externo |
| E10+ | Variantes, mesas, reparto, PIN, campañas, Wallet, terminal | P3 | Decisiones/externos | Pendiente |

E1 va antes que recetas: sin separar dinero y reposición, una devolución de una bebida preparada
regresaría inventario que ya se consumió. El resto del P0 (equipos físicos, conteo humano) es
aceptación externa, no desarrollo.

### Criterios de aceptación por entrega

- **E1:** una devolución puede no reponer la unidad; payloads anteriores conservan hash y
  reposición; reintento sin duplicados; la pérdida aparece en Merma valuada con el costo al vender
  o como incompleta. Verificado en API/PostgreSQL, unitarias y navegador mock a 390/1440 px.
- **E2:** un insumo no aparece en Caja, catálogo público ni pedidos; se compra en su unidad de
  compra (litro) y entra a existencias en unidad base (ml) sin decimales binarios; conteos y ajustes
  muestran unidades legibles; costo por unidad de compra con `Decimal`.
- **E3 (caso integral 1):** comprar leche, configurar la receta del latte, vender uno con leche de
  almendra (sustitución) y comprobar consumo exacto de cada insumo, costo de la partida y que la
  devolución no repone insumos. Ventas offline usan la versión de receta vigente al cobrar.
- **E4 (caso integral 2):** producir un lote, registrar merma y rendimiento real, vender piezas y
  comprobar que los ingredientes se descuentan una sola vez.
- **E6 (caso integral 3):** cotizar un pastel, recibir anticipo, preparar, entregar y liquidar sin
  contar dos veces el ingreso.

## Decisiones del dueño

- 26-nov-2026: insumos, unidades, recetas y producción son parte del núcleo de inventario y
  estarán en **todos los planes** (Esencial, Gestión y Standard). Compras sigue en Gestión. No
  cambia precios ni otras funciones. Se formaliza en un ADR al implementar E2/E3.
- 26-nov-2026: cada entrega sale en su propio PR con CI; no se fusiona ni se publica sin orden
  explícita.
- 27-nov-2026 (E8): los cupones van en Gestión y Standard; cualquier cajero aplica uno válido y
  hay un solo descuento por venta ([ADR-046](adr/ADR-046-cupones.md)).
- 27-nov-2026 (E7): la cola de preparación por estación está en todos los planes, recibe ventas de
  Caja y pedidos, y llama al cliente con un número corto del día
  ([ADR-045](adr/ADR-045-cola-de-preparacion.md)).
- 27-nov-2026 (E6): el ingreso de un pedido con anticipo se reconoce al liquidar. Cada negocio
  configura si un anticipo de un pedido cancelado se devuelve o se conserva, y si exige un anticipo
  mínimo para confirmar ([ADR-044](adr/ADR-044-anticipos-en-pedidos.md)).

## Validación comercial

Instrumentación existente: intentos, resultados y tiempo activo por tarea
([task_experience](../specs/reports/task_experience.md)). Falta medir producción, cierre de caja
y diferencias de inventario por negocio. El protocolo de piloto parte de la
[sesión de aceptación](runbooks/sales-readiness.md#sesión-de-aceptación-con-el-dueño--30-minutos)
y se ampliará con tareas comparables (receta, producción, compra) cuando existan E2–E4. No se
contacta a ningún negocio sin autorización ni se publican ahorros o testimonios no medidos.

## Aceptaciones externas pendientes

Equipos físicos (impresora, lector, cajón), conteo humano en un negocio, emisor CFDI y Test/Live,
aprobación de Meta para WhatsApp, contrato de terminal, revisión de un contador. Detalle y
evidencia en [`current-sprint.md`](current-sprint.md).

## Punto de continuación

1. E1 a E8, E8b y la división de cuenta por persona están publicadas; producción sirve
   `403e63b8`.
2. Falta probar con negocios reales: la cola de preparación con dos dispositivos, el anticipo de un
   pastel (caso integral 3), una cuenta dividida entre amigos y una promoción con cupón.
   Decisiones en ADR-044, ADR-045 y ADR-046.
3. Siguiente: E9 (CFDI Test, requiere el emisor del dueño) y E10+ (variantes, mesas, reparto, PIN,
   campañas, Wallet, terminal), que dependen de decisiones o proveedores externos.
