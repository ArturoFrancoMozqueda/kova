# ADR-015: Gastos pertenece al Plan Standard y se habilita por rollout

## Estado

Aceptado.

## Contexto

Kova tiene un solo plan comercial. ADR-003 y `specs/billing/standard_plan.md` establecen que el
Plan Standard de $299 MXN/mes incluye todas las funciones disponibles y que los feature flags
pueden ocultar módulos incompletos o internos, pero no crear tiers pagados.

ADR-012 ya aprobó el dominio de gastos operativos y el resultado operativo aproximado. También
decidió que la captura y el reporte permanecen ocultos bajo `margin_reports` durante el rollout.
El código conserva ese mismo límite:

- `margin_reports` es `false` por defecto y admite overrides booleanos por tenant;
- la navegación muestra **Gastos** sólo a dueños o gerentes con `expenses.manage` y con el flag;
- la vista directa de Gastos comprueba de nuevo permiso y flag;
- Análisis muestra margen, merma y resultado después de gastos sólo con el mismo flag.

La landing promete caja, inventario, roles, reportes y modo sin internet. No promete un módulo de
Gastos ni utilidad neta/fiscal. El repositorio no contiene una fuente autorizada que permita
enumerar qué tenants productivos tienen hoy el override; esa comprobación es operativa y debe
hacerse sin publicar identificadores.

## Decisión

1. **Gastos forma parte del Plan Standard cuando está habilitado.** No es add-on, plan superior ni
   entitlement de precio independiente.
2. **`margin_reports` es un control temporal de rollout, no un gate comercial.** No se ofrecerá ni
   cobrará como diferenciación entre tenants.
3. **Gastos y su resultado en Análisis permanecen acoplados al mismo flag.** Mostrar captura sin el
   reporte, o mostrar el reporte sin permitir gestionar gastos, produciría una historia incompleta.
4. **Navegación:** con el flag apagado, Gastos no aparece en el menú. Con el flag encendido, aparece
   en la sección Negocio sólo para owner/manager con `expenses.manage`. La ruta directa conserva un
   estado honesto de no disponibilidad o falta de permiso; no redirige silenciosamente ni expone
   datos.
5. **Lenguaje:** el resultado seguirá llamándose “resultado operativo aproximado”, nunca utilidad
   neta o fiscal. La landing no añadirá claims de Gastos o margen después de gastos hasta que el
   rollout sea general y exista evidencia de producción.
6. **Salida del rollout:** retirar o encender globalmente el flag requiere pruebas focalizadas,
   revisión de permisos/RLS, QA de navegación y ruta directa, y verificación con datos reales o un
   empty state. Esa salida es implementación posterior; este ADR no la autoriza por sí solo.

## Consecuencias

- PROD-1 queda resuelto como decisión de entitlement y navegación; UX-2 puede planearse contra este
  contrato sin inventar un nuevo plan.
- El Plan Standard conserva una sola oferta. Los overrides sólo controlan exposición segura durante
  el rollout.
- Para auditar el cohort actual, un operador autorizado debe obtener únicamente conteos agregados
  (`enabled`, `disabled`, `unknown`) desde el entorno objetivo. No deben guardarse tenant IDs,
  nombres, correos ni el contenido completo de `feature_overrides` en git.
- El nombre `margin_reports` agrupa costos, merma y gastos. Puede resultar amplio, pero renombrarlo
  o dividirlo exige una migración de contrato separada; no forma parte de esta decisión.

## Evidencia revisada

- `docs/adr/ADR-003-single-standard-plan.md`
- `specs/billing/standard_plan.md`
- `docs/adr/ADR-012-operating-expenses.md`
- `backend/app/tenants/feature_flags.py`
- `backend/app/tests/test_feature_flags.py`
- `frontend/src/layout/AppShell.tsx`
- `frontend/src/expenses/ExpensesView.tsx`
- `frontend/src/reports/ReportsView.tsx`
- `frontend/src/i18n/messages.ts`
