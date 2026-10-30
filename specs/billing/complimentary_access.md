# Acceso permanente de cortesía

## Problema, usuarios y valor

El propietario de la plataforma necesita conceder acceso permanente a un negocio autorizado,
sin simular un pago de Stripe ni extender artificialmente un periodo de prueba. El comercio ve
«Acceso de cortesía activo» y «Sin vencimiento» en Suscripción.

## Contrato y permisos

- `subscriptions.complimentary_access` es un booleano privado, falso por defecto. Solo se concede
  o revoca mediante una operación administrativa explícita y auditada en la base de datos.
- No hay endpoint público, campo de formulario ni configuración del comercio para modificarlo.
  No se expone como campo de suscripción en OpenAPI.
- La consulta siempre usa el tenant de la sesión. Sesión, verificación de correo, RBAC y RLS
  conservan sus controles; la concesión solo satisface el requisito de acceso comercial.
- Solo aplica cuando no existe `stripe_subscription_id`. Nunca oculta una deuda ni sustituye el
  estado de una suscripción administrada por Stripe.
- El acceso devuelve `reason=complimentary`, `trialing=false` y `trial_ends_at=null`. La concesión
  no vence; `valid_until` sigue limitado a 24 horas para revalidación de sesión y caché offline.
- Checkout rechaza crear una suscripción de pago para un negocio con esta concesión. La pantalla
  no muestra renovación, fecha de prueba ni acciones de cobro/cancelación.
- Revocar la concesión restaura la política normal. Un dispositivo desconectado conserva como
  máximo la autorización offline ya emitida; al reconectar debe revalidarla.
- La operación administrativa registra `billing.complimentary_access_granted` o
  `billing.complimentary_access_revoked`, tenant/recurso, estado anterior y nuevo, motivo y origen.
  No incluye secretos, credenciales ni correos en el registro.

## Escenarios y aceptación

```gherkin
Scenario: Cortesía permanente sin Stripe
  Given un negocio con concesión administrativa y sin suscripción de Stripe
  When termina su antiguo periodo de prueba
  Then conserva acceso comercial y ve "Sin vencimiento"
  And no puede iniciar un cobro de suscripción

Scenario: Otro negocio sin concesión
  Given un negocio sin concesión y con acceso comercial vencido
  When solicita una operación de caja
  Then sigue bloqueado por su política de facturación

Scenario: Suscripción de Stripe con deuda
  Given un negocio con una suscripción de Stripe sin pagar
  When se comprueba su acceso
  Then una marca de cortesía no oculta el estado de Stripe
```

La migración es aditiva y conserva RLS/grants. Downgrade exige revocar las concesiones antes de
eliminar la columna. Validación: gates/checkout, UI de facturación, migración PostgreSQL
upgrade/downgrade/upgrade y suites existentes de aislamiento, sesión y offline.
