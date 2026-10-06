# Kova: expansión POS e integración por agentes

Autorización del dueño: implementar, integrar branches y desplegar (2026-10-05).
Base inicial: dbd5f8c, main. Coordinación: branch feature/pos-expansion-integration-20261005.
Cada agente trabaja en una branch con worktree propio, añade contrato y pruebas, y entrega commits.
El coordinador integra en orden, resuelve conflictos, comprueba contratos completos y publica mediante CI.

## Entregas

| Agente | Branch / worktree | Resultado observable | Migración / depende de |
|---|---|---|---|
| Precios | feature/pos-pricing-20261005 / /workspace/kova-wt-pricing | Descuentos e impuesto adicional configurable, tickets, snapshots offline, devoluciones conciliadas | 0069 / 0068 |
| Clientes y catálogo | feature/pos-customers-barcodes-20261005 / /workspace/kova-wt-customers | Código de barras, clientes e historial, venta asociada | 0070 / 0069 |
| Compras | feature/pos-purchasing-20261005 / /workspace/kova-wt-purchasing | Proveedor, orden de compra, recepción con existencias y costo trazables | 0071 / 0070 |
| Sucursales | feature/pos-branch-transfers-20261005 / /workspace/kova-wt-transfers | Traspaso atómico y restricción opcional de empleado a sucursal | 0072 / 0071 |
| Preparación fiscal | feature/pos-fiscal-readiness-20261005 / /workspace/kova-wt-fiscal | Perfil de emisor y solicitud interna pendiente de proveedor, estados honestos de integración | 0073 / 0072 |
| Publicación | feature/pos-release-audit-20261005 / /workspace/kova-wt-release | Matriz de comprobación, accesos y evidencia operativa | No modifica producción |

Los números reservan una única cadena Alembic; usar revision/down_revision reales.
Los documentos de alcance diferido y el sprint se actualizarán con el estado de la integración.
El alcance autorizado incluye estas entregas aunque los planes anteriores las difirieran.
Mesas/KDS, nómina, contabilidad completa, ecommerce y lealtad siguen fuera de esta entrega.

## Condiciones de aceptación

- Mantener auth por cookies, CSRF, gates de suscripción, RLS forzado y separación de negocios.
- Configurar permisos mínimos en API y navegación; validar cada referencia de negocio/sucursal.
- Migraciones compatibles con aplicaciones anteriores y downgrade probado sin pérdida silenciosa.
- Preservar snapshots históricos de precio/costo; distribuir descuento/impuesto sin errores de redondeo.
- Ventas offline antiguas siguen sincronizando; nuevos campos preservan el origen y la idempotencia.
- Recepciones y traspasos requieren conexión, locks consistentes, auditoría e idempotencia.
- Sin analítica ficticia, estados fiscales emitidos falsos ni credenciales en navegador/logs/repositorio.
- Verificar Python/PostgreSQL, frontend, contrato OpenAPI, migraciones/grants y flujos en navegador.

## Integración y publicación

1. Integrar commits de precios → clientes/catálogo → compras → sucursales → fiscal → release.
2. Completar router, metadata, matriz RLS/grants, permisos, rutas y navegación comunes.
3. Regenerar contrato, ejecutar suites y validar flows de producto integrados.
4. Crear PR revisable; comprobar CI del commit concreto; merge a main únicamente con gates verdes.
5. CI aplica migraciones y publica Fly, verifica candidata Vercel, promociona y comprueba producción.
6. Registrar SHA, pruebas, URL y resultado real; no declarar publicado con solo merge o build.

## Dependencias externas confirmadas

El dueño confirma que no tiene PAC ni proveedor de terminal contratado. Por tanto, emitir CFDI real
y procesar tarjetas de manera integrada requieren elección, contrato, credenciales y pruebas reales.
Esta entrega prepara solicitudes y explica el estado; no reemplaza un PAC ni activa cobros.
La tarjeta manual existente y los borradores para contador no equivalen a estas integraciones.
Restore real R2/Supabase, Stripe live e inbox Gmail/Outlook solo se cierran con evidencia de sus runbooks.
El entorno actual no tiene secretos runtime ni identidad outbound; la publicación depende del acceso
al flujo GitHub Actions y sus secretos existentes. Cada bloqueo se registra con evidencia.
