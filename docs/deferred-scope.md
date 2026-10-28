# Alcance diferido

Qué **no** se construye todavía y por qué. Revisado contra el código el 2026-10-28; la versión
anterior, con su historial de autorizaciones, está en git.

Si algo de esta lista se quiere construir, primero se cumple la regla del final. Lo que ya existe en
el código pero espera aceptación externa (WhatsApp real, CFDI Live, hardware, asistente) no está
aquí: sus gates viven en [`current-sprint.md`](current-sprint.md).

## Plan y cobro

Un solo Plan Standard ([ADR-003](adr/ADR-003-single-standard-plan.md)). No se construyen:

- Niveles (Basic/Pro/Premium) ni gates de funciones por plan.
- Precio por usuario o por sucursal, planes anuales, add-ons ni cobro por uso.
- Multimoneda.

## Pagos y hardware

- Cobro integrado con terminal (Stripe Terminal u otro adquirente). Hoy se registra tarjeta
  manual; elegir proveedor exige contrato, costos y sandbox primero.
- SDK de impresoras y editor de plantillas de recibo. La impresión es la del navegador (58 y
  80 mm) y el cajón de dinero usa el conector ESC/POS por red.
- Wallet, NFC y pases de proveedores externos para la tarjeta de lealtad.

## Operación especializada

- KDS, mesas/plano del local, comandas y estaciones de cocina. Pedidos sirve a comida, retail y
  encargos sin convertirse en sistema de restaurante ([ADR-014](adr/ADR-014-customer-orders-domain.md)).
- Recetas por ingrediente, producción, repartidores, mapas y tarifas de entrega.
- Preset de restaurante. Existen `cafe`, `bakery`, `retail` y `abarrotes`.
- Precios distintos por sucursal.
- Crédito a clientes: plazos, abonos, vencimientos y antigüedad de saldos.
- Operación completa por giro (salón, clínica) más allá de Agenda, lealtad y atención actuales.

## Marketing y comunicación

- Motor de promociones y campañas masivas.
- Avisos automáticos fuera de la ventana de atención y plantillas de WhatsApp aprobadas.
- Alta de WhatsApp en autoservicio (Embedded Signup).

## Plataforma

- API pública, webhooks salientes y marketplace de plugins.
- Editor de roles personalizados. Los roles son fijos con permisos RBAC.
- SSO, SCIM, white-label, administración enterprise y jerarquía de franquicias.
- Constructor avanzado de reportes.
- Microservicios ([ADR-001](adr/ADR-001-modular-monolith.md)).

## Asistente

El asistente queda dentro de [ADR-017](adr/ADR-017-asistente-respuestas-ancladas.md). Quedan fuera:
chatbot genérico, mutaciones autónomas, SQL generado contra producción, contabilidad y nómina.
Tampoco hay metas del dueño ni plan de acción semanal generados.

## Regla para mover algo al alcance

1. Spec escrita en `specs/<dominio>/` con escenarios Gherkin y criterios de aceptación.
2. Entrada en `current-sprint.md` con la decisión del dueño.
3. No rompe el flujo diario de caja ni retrasa un gate abierto.
4. Si cambia una decisión de arquitectura, ADR nuevo.
