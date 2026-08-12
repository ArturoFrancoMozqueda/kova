# Ejecución del plan de crecimiento — Kova

Última actualización: 2026-08-12

Fuente: [`docs/audits/DIAGNOSTICO-CRECIMIENTO-2026-08-09.md`](../audits/DIAGNOSTICO-CRECIMIENTO-2026-08-09.md).

Este tablero distingue implementación, despliegue y evidencia real. Un cambio de código no cierra
por sí solo una acción que depende de Vercel, DNS, Stripe, correo o trabajo con negocios.

## Definiciones de estado

- **Cerrado:** la implementación y toda la evidencia exigida están verificadas.
- **Implementado; falta producción:** el repositorio está listo, pero falta comprobar el sistema
  desplegado o configurar un proveedor.
- **En curso:** existe avance parcial que todavía no cumple toda la aceptación.
- **Pendiente externo:** requiere trabajo comercial u operativo fuera del repositorio.
- **Diferido por señal:** sólo se inicia después de conseguir 10 pilotos activos, según el diagnóstico.

## Matriz de requisitos

| # | Acción | Estado | Evidencia actual | Evidencia necesaria para cerrar |
|---|---|---|---|---|
| 1 | Blindar telemetría anónima | Implementado; falta producción | `Origin`/`Referer`, rate limit, sesión anónima JWT de 15 min ligada a `client_id`, `signup_completed` sólo desde backend y RLS. La migración está en producción, pero la ruta de sesión aún devuelve 404 | Desplegar backend; smoke real confirma sesión → evento y rechazos sin token/origen |
| 2 | Aislar histórico contaminado | Cerrado | Supabase producción confirmó `0055_trusted_anonymous_telemetry` el 2026-08-12: 4,394 eventos históricos en cuarentena y 143 confiables; el export filtra `is_trusted=true` | — |
| 3 | Habilitar Vercel Web Analytics | Implementado; falta producción | Web Analytics y Speed Insights tienen ID en el proyecto; SDK oficiales integrados; el fallback excluye `/_vercel/*`. Preview 2026-08-12: Speed Insights responde JS 200 y Analytics ya no devuelve HTML, pero queda 404 hasta promover un deployment con Analytics | Promover el cambio revisado y confirmar primeras visitas en Analytics |
| 4 | Tablero interno de cuatro verdades | Implementado; falta producción | El cálculo y runbook están probados; una consulta agregada directa a Supabase confirmó las cuatro métricas y tres pagos live. El endpoint desplegado aún devuelve 404 | Desplegar y guardar snapshot protegido de producción sin identidades |
| 5 | SPF/DKIM/DMARC y QA de cinco correos | En curso | Gate de configuración y cinco flujos existen. Consulta pública 2026-08-12: sin TXT SPF en raíz/`mail`, sin `_dmarc` y sin MX; selector DKIM aún debe obtenerse del proveedor | Publicar DNS del proveedor y confirmar los cinco correos en inbox real de Gmail, Outlook y Hotmail |
| 6 | Quitar verificación como muro previo al valor | Implementado; falta producción | Signup inicia sesión, banner persistente; checkout sigue exigiendo correo verificado | Smoke en producción: cuenta nueva entra al POS y checkout no verificado es rechazado |
| 7 | Copy confiable de suscripción | Implementado; falta producción | Periodo incierto ya no afirma que se está verificando; sólo comunica renovación mensual conocida | QA visual en estados `stale` y `unavailable` desplegados |
| 8 | Corregir landing en blanco y LCP < 2.2 s | En curso | Recorrido Playwright móvil 2026-08-12 activó las nueve secciones, todas visibles; prueba de laboratorio observó LCP ~0.1 s y CLS 0. Speed Insights está integrado | Tráfico real de producción demuestra LCP p75 < 2.2 s en Speed Insights |
| 9 | Conseguir 10 negocios piloto en 6 semanas | Pendiente externo | Playbook, cadencia, definición de cuatro semanas activas y tracker sin PII listos | 10 negocios activos, con fecha, vertical, primera venta y seguimiento, sin exponer PII en git |
| 10 | Vender análisis, no sólo POS | En curso | Demo de 10 minutos lidera con preguntas de negocio y muestra venta → inventario/caja → Análisis | Guion usado en demos y aprendizaje anonimizado registrado |
| 11 | Respuesta para factura y tarjeta | En curso | Respuestas honestas escritas: CFDI no disponible; tarjeta se registra pero no se procesa; sin prometer proveedor ni fecha | Usarlas y validarlas en conversaciones reales |
| 12 | Entrevistar cuentas registradas que abandonaron | En curso | Guía conductual, consentimiento, taxonomía y reglas de síntesis listos | Entrevistas consentidas y síntesis anonimizada de causas de abandono |
| 13 | CFDI vía PAC verificado | Diferido por señal | Registrado en `docs/deferred-scope.md` | 10 pilotos activos y especificación/selección de PAC validada |
| 14 | Cobro con tarjeta integrado | Diferido por señal | Stripe Terminal está diferido; cobro manual se registra sin procesar dinero | 10 pilotos activos y decisión validada de Terminal/Clip/Mercado Pago |
| 15 | Descuentos y clientes/fiado | Diferido por señal | Descuentos aparecen en roadmap histórico, no implementados | 10 pilotos activos, alcance validado y especificaciones aprobadas |

## Definiciones del tablero interno

El endpoint de crecimiento devuelve únicamente agregados, protegido por `X-Internal-Key`:

- `users_created`: filas en `users`.
- `users_verified`: filas en `users` con `is_email_verified=true`.
- `tenants_with_completed_sale`: tenants distintos con al menos una orden `completed`.
- `paying_tenants`: tenants distintos con suscripción Stripe `active` y webhook procesado de pago
  exitoso con `livemode=true`; pruebas, trials y `past_due` no se cuentan como pagando.

Estas definiciones sólo pueden cambiar mediante una decisión explícita documentada y pruebas que
demuestren el nuevo contrato.

## Orden de ejecución restante

1. Desplegar y comprobar telemetría, migración y snapshot interno.
2. Promover el frontend revisado; confirmar Web Analytics y medir LCP p75 de producción.
3. Cerrar DNS y entregabilidad de los cinco correos.
4. Ejecutar smoke de signup sin muro y billing con periodo incierto.
5. Reclutar, activar y entrevistar pilotos; registrar evidencia anonimizada.
6. Reabrir CFDI, cobro integrado y descuentos/clientes sólo al alcanzar la señal de 10 pilotos.
