# Stripe — revisión de reembolsos, disputas y alertas de fraude

## Problema, usuarios y valor

El operador interno necesita revisar riesgos de cobro sin confundir un evento recibido
correctamente con una decisión sobre el acceso del negocio. El flujo protege al negocio y a
Kova contra cambios automáticos de suscripción basados en información incompleta.

## Requisitos funcionales

- Reconocer `charge.refunded`, `charge.dispute.created` y
  `radar.early_fraud_warning.created` en el webhook firmado existente. Conservar la separación
  live/test y el lock/idempotencia por `event.id`.
- Consultar exclusivamente por GET el Charge actual. Resolver su PaymentIntent mediante todas
  las páginas de InvoicePayments pagados, después Invoice → `parent.subscription_details` →
  Subscription actual → registro local por `stripe_subscription_id`. Confirmar modo, identidad
  de objetos y Customer compartido. Nunca usar metadata para asignar tenant.
- Una sola suscripción probada permite asociar el incidente a su tenant. Cero, varias,
  contradicción, registro local ausente o proveedor inaccesible requieren revisión global. No
  escoger la primera suscripción ni asignar un tenant candidato.
- El handler persiste `WebhookEvent.processing_status=processed`, evidencia mínima y una auditoría.
  Esto confirma recepción duradera; no confirma resolución del caso. Los fallos internos conservan
  el estado `failed` y admiten reintento. Una entrega duplicada no repite lecturas ni auditorías.
- Derivar un incidente crítico con la clave existente `stripe_webhook:<event_id>`, usando las
  notas y triage existentes. Incluir también los eventos de riesgo históricamente ignorados; sin
  evidencia validada, su correlación es global. Una redelivery firmada permite procesarlos.
- La fuente privada de salud `stripe_risks` es crítica mientras haya casos sin `resolved` o
  `ignored`. Reconocer, investigar o posponer no equivale a resolver. Reabrir restaura la alerta.
  `stripe_webhooks`, las métricas de fallos/atascos y Revenue conservan su significado de entrega.
- No cancelar, suspender, devolver dinero, modificar deuda, plan, acceso, gracia ni watermarks de
  facturación. Todas las decisiones de riesgo son humanas y separadas de este handler.

## Requisitos no funcionales y errores

- Cliente de lectura aislado con API Stripe `2026-09-30.endive`; no cambia la versión del resto de
  la integración. Hasta cinco páginas, veinte facturas distintas y presupuesto entre llamadas de
  quince segundos; cada lectura usa timeout de tres segundos y máximo dos intentos. Alcanzar el
  límite produce revisión global, nunca una asignación parcial. Una llamada ya iniciada puede
  terminar después del presupuesto.
- Persistir únicamente IDs técnicos, tipo, fecha, modo, importe/importe reembolsado, moneda,
  estado/motivo en formato enumeración, plazo de evidencia y resultado de correlación. Omitir
  datos de tarjeta, contacto, dirección, metadata, documentos de evidencia y cuerpos de error.
- Los logs solo incluyen tipo y resultado de correlación. La respuesta al webhook no contiene
  datos de riesgo. La vista Ops aplica la misma proyección a eventos históricos.
- La falta de lookup deja un caso duradero global; no hay un worker nuevo de reconciliación
  automática. El operador sigue el [runbook](../../docs/runbooks/stripe-risk-review.md).

## Modelo, API, permisos y offline

Se reutilizan `webhook_events`, `audit_logs` y `ops_incident_states`; no hay migración ni nuevos
estados. La evidencia va en el JSON saneado del evento. El webhook mantiene su endpoint y firma.
`GET /internal/ops/overview` añade una entrada a su diccionario `health.sources`; no cambia el
esquema. Incidentes y detalle usan endpoints existentes. Ops sigue reservado a la identidad
interna y MFA; un administrador de tenant no obtiene acceso global. El rol runtime `kova_app`
conserva RLS y no lee las tablas privilegiadas. Este flujo es online y no altera la cola offline.

## Auditoría

Una sola entrada `billing.risk_review_required` por evento, con UUID local del evento, tipo y
resultado de correlación. El triage y las notas conservan la auditoría existente de Ops.

## Escenarios y matriz de pruebas

```gherkin
Scenario: Una disputa se recibe dos veces simultáneamente
  Given una firma válida y una sola suscripción probada en PostgreSQL
  When dos entregas del mismo evento compiten por el lock
  Then existe un evento procesado y una sola auditoría de riesgo
  And el acceso, deuda y estado de suscripción permanecen iguales

Scenario: Un PaymentIntent paga facturas de dos suscripciones
  When ambas aparecen en páginas diferentes de InvoicePayments
  Then el incidente requiere revisión global y no tiene tenant asignado

Scenario: El operador reconoce y luego resuelve un caso
  Given el webhook ya está procesado y el incidente está reconocido o pospuesto
  Then Riesgos de Stripe continúa crítico sin aumentar webhooks fallidos
  When el operador marca el incidente resuelto o descartado
  Then ese caso deja de degradar Riesgos de Stripe
```

Pruebas PostgreSQL: tres tipos de evento; duplicación concurrente; metadata engañosa; paginación;
ninguna/varias/suscripción no registrada; contradicción de Customer/modo; lookup fallido y límites;
reintento tras fallo interno; histórico ignorado; feed/detalle saneado; triage/health; aislamiento
RLS del runtime. Dobles HTTP verifican método GET, versión, filtros, cursor y errores sin datos.

## Criterios de aceptación y gate externo

Código y regresiones deben pasar antes de publicar. Después, aceptar con eventos y objetos
realmente generados en sandbox, permisos de lectura de la clave y revisión manual en Ops. Solo
entonces habilitar esos tipos en el destino de webhooks live. Esta implementación no constituye
aceptación del proveedor, activación de notificaciones externas ni autorización para reembolsar.
