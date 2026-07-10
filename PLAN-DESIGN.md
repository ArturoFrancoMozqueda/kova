Kova — Plan consolidado por tareas: rediseño premium app-wide + restantes (2026-07-10)
Context
Auditoría completa hecha (3 agentes + recorrido Playwright en vivo; diagnóstico A–G presentado en el chat). Main ya integró PLAN-01..04 y PLAN-UX-01..03; RLS ya está provisionado en prod (verificado en Fly: runtime kova_app). Lo que el usuario quiere ahora: un backlog accionable que (a) extienda el stack visual del branch feature/reports-redesign a todas las tabs de la app para que se vea premium de punta a punta, y (b) consolide todo lo restante (PLAN-05, PLAN-UX-04/05, B5, quick wins, gates).

El design system que trae el branch (verificado en código):

Tokens: radios grandes (--radius-kova-* 8/12/16/20px, --radius 0.875rem), sombras suaves en capas (--kova-shadow-card/-hover) aplicadas a TODAS las Cards vía card.tsx, gradientes pastel para KPIs (--kova-grad-blue/mint/sky + bg-kova-grad-* en tailwind), easings de entrada.
Componentes reutilizables hoy encerrados en reports/: StatTile + DeltaChip (KPI con delta honesto), ReportsHeader (eyebrow + título + chips de preset + rango custom colapsable), ArcKicker (kicker de sección uppercase), ChapterNav (chips sticky móviles), ReportStates (Loading/Error/Empty/PermissionDenied), kit de charts (ChartCard, SalesTrendChart, RankBarChart, DistributionBar, ChartDetailPanel, useChartSelection) y utils puros (calculateSafeGrowth, formatCompactMoney).
Preferencia del usuario: trabajar directo en main (el merge del branch es la excepción necesaria).

Épica 0 — Mergear feature/reports-redesign (fuente del design system) — PRIMERO
T0.1 (S) Fix bug de claves de pago en el branch: PaymentAnalysis.contextLine filtra "card"|"transfer"; el backend emite cash|bank_transfer|manual_card → el insight "card-heavy" nunca se muestra. Corregir + test del ramo.
T0.2 (M) Rebase sobre main y resolver los 3 archivos compartidos: backend/app/reports/service.py (no duplicar _payment_label/_MONTHS_ES con lo que PLAN-04 ya añadió), frontend/src/i18n/messages.ts (objeto gigante; main añadió corte, confirm, pos.printReceipt; el branch añade ~299 líneas reportsView.*), frontend/src/styles.css (conservar bloque @media print del corte de PLAN-UX-02).
T0.3 (S) Adoptar net_amount de PLAN-04: declararlo en reports/types.ts, usarlo en PaymentAnalysis y R6 para que el mix de pagos concilie con ventas netas en días con devolución (hoy el branch usa amount bruto).
T0.4 (S) Unificar umbrales: R2/R4/R5/R7 en recommendations.ts hardcodean valores que divergen de INVENTORY_THRESHOLDS en calculations.ts (tabla marca "en caída" a −20%, R7 dispara a −30%) → una sola fuente; borrar salesByDayAverage muerto.
T0.5 (S) Validación visual del cambio global de card.tsx (sombra en todas las Cards de la app) con un pase por Panel/Catálogo/Órdenes/Ajustes/Billing; limpiar copy huérfano tour.reports* (el branch elimina el tour de reportes) y confirmar que el funnel de PLAN-UX-03 no espera ese evento.
T0.6 (XS) El branch trae el fix del proxy Docker (vite.config.ts lee VITE_API_BASE_URL); si el merge se retrasa, cherry-pick de 2e45de3 a main — hoy el frontend dockerizado apunta a localhost:8000 y toda la app falla dentro de compose (reproducido en vivo).
Aceptación épica: typecheck/lint/tests/build verdes; e2e de reports; con datos de tarjeta+transferencia el insight card-heavy aparece; mix neto = ventas netas con una devolución; corte de caja sigue imprimiendo.
Épica 1 — Promover el kit a compartido (components/)
T1.1 (M) StatTile + DeltaChip → components/ui/stat-tile.tsx; mover calculateSafeGrowth/GrowthResult y formatCompactMoney a lib/ (o reports/utils importable sin ciclo). Mantener re-exports en reports/ para no tocar sus tests.
T1.2 (S) Patrón de encabezado de vista → components/ui/view-header.tsx (eyebrow + h1 tracking-tight + slot de acciones), extraído de ReportsHeader. Los presets de fecha quedan en reports.
T1.3 (S) ReportStates → components/ui/view-states.tsx (Loading/Error con retry/Empty con CTA/PermissionDenied) para reuso fuera de reports.
T1.4 (S) Skeleton compartido para el fallback de Suspense (App.tsx:35-37) y RequireAuth.tsx:7 — hoy pantalla en blanco en cada navegación lazy y al resolver sesión.
Épica 2 — Rediseño por tab con el stack premium
T2.1 (M) Panel (dashboard/DashboardView.tsx, 982 líneas): sustituir DeltaBadge local (línea ~148, cálculo naive ((cur-prev)/prev)*100 → puede mostrar "+900% desde $1") por DeltaChip+calculateSafeGrowth; KPIs con StatTile y washes bg-kova-grad-*; ViewHeader; kickers tipo ArcKicker entre bloques (Hoy / Qué hacer / Salud del negocio). Bonus perf: consolidar las ~13 requests por toggle de periodo (batch o react-query con cache por periodo).
T2.2 (M) Caja (register/RegisterView.tsx): densidad del grid de productos — a 390px hoy no se ve NI UN producto above-the-fold (placeholders de imagen gigantes + banner + chips); modo compacto sin placeholder cuando el producto no tiene imagen, y en móvil filas más bajas. Reposicionar el toast de éxito (hoy tapa el chip PRUEBA GRATIS). Aplicar sombras/hover kova a cards de producto.
T2.3 (M) Órdenes + Turnos: tabla de turnos cerrados (ShiftView.tsx:~350) → patrón dual card/table que ya usa OrderList (y que el redesign usa en ProductInventoryAnalysis); ViewHeader en ambas; en OrderDetail sustituir el JSON.parse((err as Error).message) (líneas 69-77) por manejo tipado y estados 404/409 distintos (se solapa con T3.2).
T2.4 (S) Catálogo + Inventario: ViewHeader + view-states compartidos; badges/chips consistentes con el kit; explicar la base del cálculo de velocidad ("según ventas de los últimos N días") en un title/tooltip.
T2.5 (S) Configuración + Facturación: alinear tipografía/espaciado al kit; localizar row.status crudo de invitaciones (SettingsView.tsx:401) y añadir reenviar/revocar invitación (backend ya tiene tokens; verificar endpoints).
T2.6 (M) Móvil transversal (PLAN-UX-04): chip online/offline+cola persistente en la top bar móvil (hoy solo en footer del sidebar, AppShell.tsx:182); split-payment a 360px; targets <44px (CatalogView.tsx:431,585); chip de prueba compacto en top bar (hoy se amontona).
Aceptación épica: pase visual con el tour Playwright (tour.cjs del scratchpad) a 1440 y 390 comparando capturas; ningún número de dinero sin tabular-nums; deltas honestos en Panel (caso base pequeña).
Épica 3 — Estados y validación (PLAN-UX-05)
T3.1 (M) Estado local "suscripción inactiva" reutilizable para Inventario/Órdenes/Reportes/Turnos (hoy solo Catálogo maneja el 402 inline): panel con CTA "Activar plan" → /settings/billing.
T3.2 (S) Estados 404/409 distintos en OrderDetail y rutas de detalle (junto con T2.3).
T3.3 (S) Validación específica (no disable-only) en InventoryModal, CashMovementModal, OpenShift/CloseShiftModal: mensaje inline del porqué ("dejaría el stock en −3", "monto requerido").
T3.4 (S) Signup: botón "Reenviar correo de verificación" con countdown (hoy la única vía es re-enviar el formulario) y mapear el 422 de email inválido a mensaje claro; fix copy duplicado (ver T5.1).
Épica 4 — Backend restantes (PLAN-05 + billing)
T4.1 (XS) hmac.compare_digest para la clave interna (billing/router.py:130).
T4.2 (S) Revocar sesiones al desactivar/degradar empleado (employees/service.py:~288-308).
T4.3 (S) Lock del último owner (TOCTOU en _count_active_owners, employees/service.py:26).
T4.4 (M) Login multi-tenant: .first() en auth/repository.py:73-78 → selector de tenant (o al menos determinismo + telemetría).
T4.5 (S) Guard import.meta.env.DEV al render de dev tokens; política de contraseña de invitación = signup; piso de entropía SECRET_KEY.
T4.6 (M) B5: endpoint + UI "Reanudar suscripción" durante cancel_at_period_end; decidir postura de lecturas para churned (hoy bloqueadas).
T4.7 (M, post-beta) S10: exportación de datos + borrado de cuenta (LFPDPPP) — programar, no bloquear.
Épica 5 — Quick wins de confianza (1 sesión)
T5.1 (XS) Copy duplicado del signup: messages.ts:650 acceptTermsOfKova: "de Kova. Conozco también" + :654 signupSecurityPrefix: "Conozco también la" → se lee "Conozco también Conozco también".
T5.2 (S) Sustituir posprojectsupport@gmail.com (14 usos en Home.tsx/LegalPage.tsx) por mailbox del dominio cuando exista; mientras, unificar detrás de una constante.
T5.3 (XS) Limpiar .tmp_vite*.log, frontend/src/offline$f; mover los ~12 .md de auditoría/planes de la raíz a docs/audits/.
T5.4 (S) Actualizar docs/current-sprint.md al estado real (PLAN-01..04, UX-01..03 cerrados; este backlog como sprint activo).
Épica 6 — Gates operativos (sin código, antes de cobrar)
Stripe live full-flow (checkout→webhook→active→past_due→cancel→resume), QA deliverability de los 5 emails (Gmail/Outlook), restore drill R2→Supabase documentado, beta agreement firmado. RLS ya ✓.

Orden sugerido de ejecución
Épica 0 (desbloquea todo lo visual) → 2. Épica 5 (mismo día) → 3. Épica 1 → 4. Épica 2 (T2.1 Panel primero: es la cara del producto) → 5. Épica 3 → 6. Épica 4 → Épica 6 corre en paralelo (operativa).
Verificación
Por tarea: npm run typecheck && npm run lint && npm test -- --run; backend docker compose exec backend uv run pytest (override de get_privileged_db en tests RLS).
Por épica visual: re-correr tour.cjs (scratchpad) a 1440/390 y comparar capturas contra shots/.
Antes de cerrar: npm run build + e2e chromium + docker compose up limpio (valida T0.6).
Estado del entorno
Docker corriendo (db+backend); contenedor frontend detenido (bug proxy T0.6); dev server host en 5173. Cuenta de prueba local: audit.kova.2026@gmail.com / turno cerrado con corte.