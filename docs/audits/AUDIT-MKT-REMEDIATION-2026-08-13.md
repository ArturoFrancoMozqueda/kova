# Auditoría de remediación MKT — 2026-08-13

## Alcance y criterio

Revisión de landing, precio, FAQ, signup, billing, Términos, Seguridad, SEO técnico y pruebas. La
fuente comercial vigente es el `Plan Standard` de $299 MXN/mes y 7 días de prueba sin tarjeta. La
etapa vigente se deriva de `docs/current-sprint.md`, `docs/beta-agreement-template.md`,
`docs/architecture.md` y `frontend/src/lib/support.ts`: **beta privada controlada**. No se cambió
precio, plan, trial, billing gates ni contratos de API.

Estados usados:

- **Cerrado en repositorio:** copy/código y pruebas verifican la aceptación que depende del repo.
- **Pendiente externo:** necesita evidencia o autorización fuera de git.
- **Condicionado por señal:** no se implementa antes de la señal definida por producto.

## Resultado por tarea

| Tarea | Estado | Evidencia |
|---|---|---|
| MKT-1, tarjeta manual | Cerrado en repositorio | Landing y precio dicen `tarjeta manual`; FAQ, Términos y Seguridad separan el registro del método de pago de la terminal/procesamiento del dinero. Billing ya usaba `tarjeta manual`. |
| MKT-2, CFDI | Cerrado en repositorio | FAQ y Términos declaran que Kova no emite CFDI; el texto fiscal del recibo no equivale a factura; no se publica PAC, proveedor o fecha. |
| MKT-3, claims de Seguridad | Cerrado en repositorio | `/seguridad` se fechó y se reescribió contra controles verificables. El restore se presenta como pendiente, no probado; se retiraron detalles criptográficos innecesariamente frágiles y “alerta inmediata”. |
| MKT-4, etapa | Cerrado en repositorio | La etapa documentada, landing, signup, billing, Seguridad, Términos y soporte dicen beta privada/controlada o no hacen un claim de etapa. Los correos transaccionales no prometen una disponibilidad distinta. |
| MKT-5, prueba social | Pendiente externo | No existe en git un mini caso con periodo/resultado ni una referencia verificable a la autorización archivada fuera de git. No se añadieron nombres, cargos, ciudades, cifras o testimonios. |
| MKT-6, objeciones | Cerrado en repositorio | FAQ cubre terminal, CFDI, IVA/impuestos, fin del trial, soporte, exportación tras cancelar, offline y anti-fit. Las respuestas se trazaron a producto, billing, lifecycle, soporte y legales. |
| MKT-7, inmediato | Cerrado en repositorio | JSON-LD obtiene precio/moneda de `standardPlan.ts` vía el bundle SSR; canonical se genera por ruta pública; el app shell tiene `noindex`; robots incluye auth, producto y rutas auxiliares; sitemap actualiza sólo páginas modificadas. |
| MKT-7, páginas profundas | Condicionado por señal | No hay entrevistas suficientes para 3–5 páginas de vertical/problema. No se crearon páginas delgadas. |

“Cerrado en repositorio” no afirma que estos cambios estén desplegados. El smoke sobre el build
prerenderizado y la promoción a producción siguen perteneciendo al release correspondiente.

## Inventario versionado de claims publicados

| Claim / superficie | Alcance honesto | Evidencia primaria | Owner | Última revisión | Caducidad / gatillo |
|---|---|---|---|---|---|
| Plan Standard, $299 MXN/mes | Un plan mensual; sin cambio comercial en esta remediación | `frontend/src/billing/standardPlan.ts`, ADR-003, billing backend | Producto + Billing | 2026-08-13 | Cada cambio de Stripe/config; revisión trimestral 2026-11-13 |
| 7 días gratis, sin tarjeta | Trial de signup; al terminar se requiere activar el plan | `frontend/src/billing/trial.ts`, config backend, matriz de billing | Producto + Billing | 2026-08-13 | Cada cambio de trial/config; 2026-11-13 |
| Beta privada controlada | Acceso con cambios frecuentes, soporte directo y sin SLA formal | `docs/current-sprint.md`, acuerdo beta, `support.ts` | Producto + Operaciones | 2026-08-13 | Al decidir beta abierta/GA; 2026-10-13 |
| Tarjeta manual | Kova registra el método; la terminal externa procesa el dinero | `orders/format.ts`, ADR-008, deferred scope | Producto | 2026-08-13 | Al integrar un procesador/terminal |
| Sin CFDI / sin cálculo fiscal | Recibo operativo, no factura; precio configurado, sin cálculo/desglose de impuestos | `docs/deferred-scope.md`, settings/receipt, producto actual | Producto + Legal | 2026-08-13 | Al aprobar e implementar alcance fiscal |
| Caja offline | Sólo una caja preparada en el dispositivo; persiste localmente y sincroniza al volver la conexión | implementación y pruebas `frontend/src/offline`, checklist offline | Ingeniería | 2026-08-13 | Cada cambio de cola/cache; revisión 2026-09-13 |
| Aislamiento por negocio | API con contexto tenant y Postgres RLS bajo rol runtime restringido | ADR-009, migración `0036_force_rls`, tests RLS, boot check | Backend + Seguridad | 2026-08-13 | Cada migración/rol/RLS; revisión 2026-09-13 |
| Cookies y CSRF | Credenciales en cookies HttpOnly; Secure/SameSite en producción; CSRF adicional para escrituras | threat model de cookies/CSRF y tests auth | Backend + Seguridad | 2026-08-13 | Cada cambio de auth/cookies; revisión 2026-09-13 |
| Backup diario, retención 7 días | Workflow configurado y upload verificado por corrida; no equivale a restore probado | `.github/workflows/db-backup.yml`, deployment, current sprint | Operaciones | 2026-08-13 | Cada fallo/cambio de workflow; revisión mensual |
| Restore | Procedimiento documentado; simulacro real aún pendiente | runbook de restore, current sprint, OPS-3 | Operaciones | 2026-08-13 | Caduca de inmediato hasta ejecutar OPS-3 |
| Monitoreo cada 5 minutos | Tres endpoints documentados; confirmación previa a alerta, sin SLA | runbook UptimeRobot, current sprint, service audit | Operaciones | 2026-08-13 | Cada cambio de monitor/proveedor; revisión mensual |
| Exportación y eliminación | Propietario descarga ZIP; cancelar suscripción no elimina la cuenta | account lifecycle, endpoint y tests | Producto + Backend | 2026-08-13 | Cada cambio de lifecycle/retención; revisión trimestral |
| Testimonios Sweet Home/Café Chapatito | Citas existentes sin mini caso verificable en repo | `testimonials.data.ts`; autorización/PII debe vivir fuera de git | Marketing + Legal | 2026-08-13 | **No apto para ampliar** hasta registrar referencia no sensible de consentimiento y evidencia |

## Objeciones: fuentes de respuesta

- Terminal y tarjeta: ADR-008, `orders/format.ts` y pagos del POS.
- CFDI e impuestos: `docs/deferred-scope.md` y ausencia de cálculo fiscal en el producto actual.
- Trial y activación: `standardPlan.ts`, `trial.ts`, matriz y pruebas de billing.
- Cancelación/exportación: `docs/account-lifecycle.md`, `settings/api.ts` y tests backend.
- Offline: implementación/tests de la cola y `docs/offline-qa-checklist.md`; el copy ahora evita
  prometer que cualquier dispositivo no preparado funcionará en frío.
- Soporte: `support.ts`, acuerdo beta y `/seguridad`; no se promete SLA.
- Anti-fit: restaurantes con mesas/comandas complejas y agendas por hora siguen fuera del foco.

## Bloqueos y trabajo no ejecutado

1. **MKT-5:** Marketing/Legal debe conservar consentimiento fuera de git y registrar aquí sólo una
   referencia no sensible. El mini caso requiere persona/cargo/ciudad, contexto, periodo y resultado
   demostrable; no debe publicarse PII ni una métrica sin autorización.
2. **MKT-7 condicionado:** las páginas por vertical/problema esperan entrevistas y señal real. No se
   generó contenido programático.
3. **Restore:** OPS-3 debe ejecutar R2 → Supabase fresco y registrar resultado. Hasta entonces
   Seguridad seguirá diciendo que el ejercicio está pendiente.
4. **Producción:** el release debe verificar HTML canonical/noindex/JSON-LD y robots/sitemap en el
   dominio final después de desplegar.

## Validación

Ejecutado en esta rama:

- `npm test -- --run src/routes/Home.test.tsx src/routes/LegalPage.test.tsx src/auth/AuthView.test.tsx src/billing/standardPlan.test.ts`: **29 pruebas aprobadas**. JSDOM imprimió los warnings preexistentes de rutas no montadas y canvas de axe; no hubo fallos.
- `npm run lint`: **aprobado**.
- `npm run build`: **aprobado**, incluido SSR y prerender de `/`, legales y `app-shell.html`.
- `$env:PLAYWRIGHT_USE_PREVIEW='1'; npx playwright test e2e/seo.spec.ts --project=chromium`: **6 pruebas aprobadas**. El preview local reportó rechazos esperados al intentar llegar al backend no levantado; las pruebas SEO no dependen de esas llamadas.
- `git diff --check`: **aprobado**.

QA de copy con los siete barridos: claridad, voz, beneficio, prueba, especificidad, emoción y riesgo se
revisaron después de los cambios. Panel final sobre las superficies editadas: copy de conversión 8/10,
UX writing 9/10, dueño escéptico 8/10 y marca/producto 9/10. La principal reserva es la prueba social
existente, registrada por separado como MKT-5 y no ampliada en este cambio.

QA manual recomendada antes de desplegar:

- revisar landing en 320 px y desktop, en especial hero, precio y FAQ expandida;
- abrir signup y confirmar que la etapa no desplaza ni confunde precio/trial;
- abrir `/terms` y `/seguridad` y comprobar legibilidad;
- inspeccionar el HTML construido de `/`, una legal y `app-shell.html` para canonical/noindex;
- confirmar que ningún testimonio, nombre, ciudad o métrica nueva fue añadido.
