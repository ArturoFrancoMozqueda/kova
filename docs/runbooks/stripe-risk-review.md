# Stripe — revisión operativa de riesgos

## Alcance y publicación

Este flujo recibe `charge.refunded`, `charge.dispute.created` y
`radar.early_fraud_warning.created` y abre revisión interna. No cancela suscripciones, cambia
acceso, crea deuda ni emite reembolsos. Los eventos de lifecycle y pagos conservan sus reglas.

Secuencia de habilitación y aceptación del destino live:

1. Publicar el handler con CI y release completos. No suscribir tipos antes de tener el handler.
2. Confirmar, sin exponer claves, que la credencial del servidor permite leer Charges,
   InvoicePayments, Invoices y Subscriptions. No ampliar permisos de escritura para este flujo.
3. Generar los casos en el sandbox dedicado, con su propia firma y credenciales. Comprobar el
   grafo actual del proveedor y sus permisos, entrega duplicada, correlación y triage en Ops.
   Los dobles sintéticos de CI no sustituyen esta aceptación. El cliente de riesgo usa
   `2026-09-30.endive` de forma aislada; la versión de los demás clientes no cambia.
4. Habilitar los tres tipos en el destino correcto mediante un cambio de proveedor autorizado.
   Verificar separación live/test y una recepción real controlada. Este cambio no lo ejecutan
   los tests ni este runbook por sí solo.

Referencia del grafo oficial: [eventos de reembolso de Stripe Billing](https://docs.stripe.com/billing/subscriptions/webhooks#refund-events).

### Aceptación sandbox comprobada

El [run 41756012658](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41756012658) aprobó
sobre `5fd7b35f75a33a76172afb58524a4cab89e277fd`, con `include_portal=false`. La implementación
de riesgo conserva la publicada en PR #311. La [evidencia revisada](../audits/evidence/KOV-005-STRIPE-RISK-DRILL-2026-11-03-standard.md)
registra la primera entrega de los tres tipos reales por el listener firmado del sandbox:

- `charge.refunded`: el grafo probó una suscripción y la correlación local `matched`.
- `charge.dispute.created` y `radar.early_fraud_warning.created`: Customers QA separados sin
  facturas produjeron revisión global `no_subscription`, sin asignar un tenant supuesto.
- Cada caso mantuvo un intento y una auditoría tras replay, sin modificar estado comercial;
  las consultas aisladas de Ops comprobaron visibilidad y persistencia del triage.

Checkout Standard y su ciclo de renovación/falla/gracia/recuperación/cancelación/orden también
aprobaron. Se eliminaron tres relojes y tres Customers QA; ambos pasos de limpieza aprobaron y
se retiró la copia temporal de la clave de GitHub. Los PaymentIntents/Charges pagados de prueba
y su historial de riesgo permanecen como registros del proveedor; no se afirma que se borraron.

Este resultado cierra la aceptación real sandbox de esos tres tipos en esa fuente. No acredita
Portal, cobro live, aceptación fiscal ni una decisión operativa sobre casos productivos.

### Destino live habilitado, recepción pendiente

El dueño autorizó habilitar los tres tipos de riesgo y reenviar un evento histórico. El formulario
oficial de Stripe guardó la habilitación; la consulta posterior por API confirmó nueve tipos
exactos, conservando los seis anteriores, la dirección del destino y su versión de API
`2026-04-22`. La shell del Dashboard rechazó la escritura en modo live por ser de solo lectura;
no se eludió esa restricción ni se cambiaron claves o la versión del destino.

El reenvío sigue sin completarse. La [Shell oficial](https://docs.stripe.com/workbench/shell)
es de solo lectura en live también para el usuario; el comando preparado para ese canal se retiró. Se requiere CLI nativa con autenticación
live autorizada u otra vía permitida, sin extraer una clave live. Los identificadores y contexto
del evento permanecen privados; no hay un paso pendiente de pulsar Enter en esa Shell. Stripe
permite reenvío manual desde Dashboard hasta quince días y desde CLI hasta treinta días desde la
creación, según [reintentos manuales](https://docs.stripe.com/webhooks#manual-retries). Elegir una
ruta disponible dentro de ese plazo no acredita que la entrega ya ocurrió.

Permanecen pendientes confirmar los permisos de lectura de la credencial live, verificar recepción
controlada y correlación real, y revisar el flujo en la UI del fundador con MFA. Nueve tipos
habilitados no prueban esos pasos ni validación fiscal. Este pendiente no bloquea la aceptación
interactiva de Portal sandbox ni la activación del catálogo autorizado. El
[Portal básico sandbox ya aceptado](../audits/evidence/KOV-005-STRIPE-INTERACTIVE-PORTAL-2026-11-03.md)
conserva un alcance distinto de la recepción histórica live.

## Revisar un caso

1. Entrar a `/internal/ops` con la identidad interna y MFA vigente. Una cuenta administradora de
   negocio no sustituye este permiso. Abrir **Incidentes** → el caso crítico de Stripe. La fuente
   **Riesgos de Stripe** en Estado general enlaza a esa lista.
2. Reconocer el incidente y pasar a **Investigando** mientras se verifica. Abrir el enlace al
   evento en Stripe en el modo correcto. Consultar el Charge, el reembolso total/parcial, la
   disputa o la alerta y, cuando exista, su plazo de evidencia. No copiar tarjetas, direcciones,
   correo, documentos, claves ni datos personales a notas de Kova.
3. Revisar el resultado de correlación mostrado en el detalle:

   | Resultado | Qué revisar |
   |---|---|
   | `matched` | Una suscripción y Customer coinciden con el registro local; confirmar contexto del negocio. |
   | `multiple_subscriptions` | Varias suscripciones comparten el PaymentIntent; revisar todas, sin elegir una por conveniencia. |
   | `no_subscription` | No hay suscripción demostrable; puede ser un pago fuera del alcance de Kova. |
   | `unmapped_subscription` | Stripe tiene la suscripción pero Kova no la reconoce; revisar integración y cuenta. |
   | `inconsistent_ownership` | Modo, objeto o Customer contradictorio/incompleto; no asociar tenant. |
   | `lookup_unavailable` | Revisar disponibilidad y permisos de lectura. Nunca copiar el error crudo o la clave. |
   | `lookup_limit` | El grafo superó presupuesto, páginas o facturas; completar investigación manual sin asignación parcial. |

4. Un caso global no tiene propietario tenant probado. Los IDs técnicos son evidencia para el
   operador; no son permiso para editar datos de un negocio. No reparar la correlación mediante
   SQL ni metadata. Documentar una conclusión breve y verificable en las notas internas.
5. En disputas, atender el plazo y la evidencia en Stripe mediante el procedimiento autorizado
   correspondiente. Este handler no responde la disputa ni concede permisos para hacerlo. Una
   alerta temprana tampoco equivale a fraude confirmado. Decidir reembolsar/cancelar requiere un
   flujo separado autorizado; no se infiere de marcar un incidente.
6. Marcar **Resuelto** solo al completar la revisión y las acciones acordadas, o **Descartado** si
   se verificó que no requiere acción. Guardar motivo sin información sensible. Reabrir si hay
   información nueva; la salud vuelve a reflejarlo.

## Significado de los estados y salud

- `WebhookEvent.processed` significa que la recepción y evidencia son duraderas; el caso puede
  seguir abierto. Duplicados posteriores no repiten consultas ni auditoría.
- **Riesgos de Stripe** es crítico mientras exista un caso sin `resolved` o `ignored`, sin ventana
  temporal que lo haga desaparecer. Reconocer, investigar o posponer mantiene la alerta.
- **Webhooks Stripe**, webhooks fallidos, atascados y Revenue miden entrega/procesamiento. Un
  riesgo procesado no aumenta esos fallos. Una excepción interna sí es un fallo y se reintenta.
- Incidentes históricos ignorados siguen visibles globalmente hasta revisión. Una redelivery
  firmada de Stripe puede aportar correlación validada; no cambiar manualmente estados en SQL.
- La lista prioriza pendientes sobre archivados, hasta cien casos por consulta. Resolver el lote
  expone pendientes anteriores; la salud cuenta todos los pendientes, no solo los visibles.
- Ops actualiza en su ciclo existente de polling. El `/health` público conserva su función de
  disponibilidad, sin exponer riesgos financieros.

No existe nueva reconciliación automática ni envío de emails/páginas de alerta en este cambio.
Un lookup inaccesible permanece como revisión global aun después de recuperar el proveedor:
la redelivery del evento ya procesado es idempotente. Completar la investigación y sus notas en
Ops; una automatización de reconciliación requiere otro cambio explícito. Mantener vigilancia
operativa en Ops y en el Dashboard de Stripe; no prometer alertas externas que no están configuradas.

## Límites y seguridad

La correlación consulta Charge → PaymentIntent → InvoicePayments paginados pagados → cada Invoice
→ su Subscription → registro local. Se valida identidad/modo/Customer en cada relación disponible;
metadata no decide el tenant. Se leen hasta cinco páginas y veinte facturas distintas. El
presupuesto se comprueba entre llamadas a los quince segundos; una llamada iniciada puede
terminar después (timeout de tres segundos, máximo dos intentos por lectura). Un límite o
ambigüedad produce revisión global; nunca una asignación de la primera coincidencia.

Solo se guardan IDs técnicos y campos mínimos de riesgo, importes enteros/moneda, plazo y
resultado. La proyección del detalle también sanea eventos históricos. Los logs incluyen tipo y
resultado sin payload ni respuestas del proveedor. No se conserva un espejo de direcciones,
Customer ni método de pago: `customer.updated` no es necesario para esta proyección. Si se añade
ese espejo en otro cambio, habrá que definir su sincronización y permisos explícitamente.

Evidencia automatizada: `backend/app/tests/test_stripe_risk.py` y
`backend/app/tests/test_stripe_risk_client.py`, sobre PostgreSQL real y proveedor simulado.
La aceptación real sandbox posterior al release está registrada arriba; las pruebas sintéticas
no la sustituyen. La habilitación de los tres tipos live está comprobada; permisos de lectura,
reenvío y recepción controlada, y UI con MFA conservan sus pendientes separados.
