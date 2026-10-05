# Sucursales y análisis comparativo

Estado: implementada y validada localmente; pendiente de publicación.
Prioridad autorizada por el owner el 2026-10-05; sustituye el gate de demanda de Phase 4.

## Resultado

Un negocio puede crear y nombrar sucursales, operar caja e inventario en cada una y comparar cuánto
vende cada sucursal y qué productos vende, dentro del mismo periodo. No incorpora chatbot ni SQL
generada: las respuestas se presentan directamente en Análisis con datos reales.

## Contrato

- Tenant y sesión siguen siendo la autoridad; una sucursal de otro tenant devuelve 404.
- Catálogo, precios, empleados, configuración fiscal y suscripción pertenecen al negocio y se comparten.
- Ventas, turnos, movimientos, reservas, pedidos y gastos pertenecen a una sucursal inmutable.
- Una sola caja abierta por sucursal; diferentes sucursales pueden abrir simultáneamente.
- Las cuentas existentes conservan todo el historial en `Sucursal principal`. Su ID equivale al del
  tenant para una atribución determinista de clientes y colas antiguos.
- `X-Kova-Branch` selecciona el contexto operativo; omitirlo selecciona siempre la principal.
- Los roles conservan su alcance actual dentro del negocio. Settings permite crear/renombrar;
  Reports permite comparar. Asignación de empleados exclusivamente a sucursales queda fuera de v1.
- Las colas nuevas persisten branch_id al registrar la venta. Sync valida cada sucursal antes de
  cualquier efecto y restaura el contexto por ítem, aunque la sucursal activa haya cambiado.
- Registros offline antiguos sin sucursal pertenecen a principal, nunca a la sucursal al sincronizar.
- Idempotencia conserva la identidad original y rechaza reutilizarla en otra sucursal.
- Comparaciones usan ventas completadas, devoluciones atribuidas a la venta original, nombres/precios
  históricos y la zona horaria del negocio; incluyen sucursales sin ventas y no deducen rentabilidad.
- No cambia el precio ni procesa cobros de terminal; no incorpora traspasos, precios distintos por
  sucursal, zonas horarias diferentes ni consolidación fiscal adicional.

## Aceptación y QA

- Crear dos sucursales, abrir ambos turnos, vender el mismo producto y comprobar stock y caja separados.
- Comparar venta neta, tickets y unidades/productos; refund tardío y void concilian con análisis existente.
- Rechazar sucursal ajena, caja de otra sucursal y mutaciones bajo sucursal incorrecta.
- Sincronizar ventas de varias sucursales en un lote; un fallo no reasigna ni duplica las demás.
- Migración poblada conserva importes, FKs y RLS; downgrade rechaza pérdida de datos multiubicación.
- Selector visible en móvil/escritorio; cambio en línea con confirmación de descarte de carrito.

## Escenarios BDD

```gherkin
Scenario: Comparar ventas reales entre sucursales
  Given dos sucursales del mismo negocio con ventas completadas
  When el owner abre Análisis y elige un periodo
  Then ve la sucursal con mayor venta neta y los productos/unidades de cada una
  And los empates y sucursales sin ventas se indican sin inventar un ganador

Scenario: Conservar origen durante sincronización offline
  Given una venta pendiente registrada en Centro y otra antigua sin sucursal
  When se sincronizan desde Norte
  Then la primera pertenece a Centro y la antigua a Sucursal principal
  And repetir el lote no duplica ventas ni permite reasignarlas

Scenario: Proteger datos entre sucursales y negocios
  Given una sesión de un negocio con una sucursal activa
  When solicita una venta de otra sucursal o una sucursal de otro negocio
  Then recibe 404 y no modifica ventas, caja ni inventario
```

## Publicación y reversión

Aplicar 0068 con el rol de migraciones, verificar grants/RLS y publicar backend antes de frontend.
Los clientes antiguos y sus colas mantienen el contexto principal. El downgrade solo es permitido
si no existen sucursales adicionales; una reversión de aplicación después de crear sucursales debe
conservar el esquema y restaurar una versión compatible con multiubicación. No usar una versión
anterior para operar sucursales adicionales.

## Evidencia local (2026-10-05)

- Backend: suite completa con 739 pruebas aprobadas. Los dos health checks omitidos al no haber
  `DATABASE_URL` en el entorno pasaron al ejecutar `test_health.py` con la URL local explícita.
- `app/tests/test_branches.py`: 14 pruebas aprobadas, incluidas reservas/pedidos y gastos aislados,
  FKs y rechazo SQL de reasignación, roles, RLS real, idempotencia, sync mixto, productos renombrados
  y consolidación fiscal. Tres de estos casos se incorporaron después de la suite completa.
- Frontend: 128 archivos y 689 pruebas aprobadas; pruebas de cola persistente, caché de pedidos,
  headers de identidad/sucursal, selector, ajustes, errores y comparación.
- Migraciones 0062, 0065 y 0068 aprobadas en bases temporales de PostgreSQL 16. Se ejecutó el script
  real de aprovisionamiento con psql en el contenedor, incluida su repetición y matriz de permisos.
- Typecheck, ESLint, Ruff, contrato OpenAPI, build/prerender y análisis de secretos aprobados.
- QA del paquete de producción con `kova_app`, sin privilegios de owner: crear sucursal, cancelar
  y confirmar el cambio, leer comparación y productos. Principal $60 + Centro $120 = negocio $180;
  Centro aparece como líder, con 3 unidades de Pan artesanal y 2 de Galleta.
- Chromium: anchos 320/390/768/1440 sin overflow horizontal; Escape cierra la confirmación;
  comparación sin violaciones axe WCAG 2 A/AA ni errores de JavaScript.

Las expectativas antiguas de POS ahora incluyen la sucursal de origen como quinto argumento de
la cola. El fixture de requests descarta el contexto de sucursal al terminar cada request, como
lo hace el cierre de sesión SQL en producción. El seed concurrente crea primero el tenant y su
principal antes de insertar el turno. Los contratos de tenant, dinero y cola siguen comprobados.
