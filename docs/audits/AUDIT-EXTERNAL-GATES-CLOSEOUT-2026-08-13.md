# Cierre verificable de gates externos — 2026-08-13

Rama: `feature/audit-external-gates-closeout`

Commit base auditado: `8e15269bceb6758f1f687a3ab217adaf1ab445a8`.

Hora del corte: `2026-08-14T04:29Z` (UTC).

## Alcance y regla de seguridad

Este corte revisa OFF-6, BILL-4, MKT-5, MKT-7 condicionado, OPS-1…OPS-6 y PROD-2. Sólo se
ejecutaron consultas de lectura sobre DNS público, GitHub Actions, nombres de secretos y postura de
Fly. No se inspeccionaron valores de secretos ni datos de tenants. No se enviaron correos, no se
crearon cargos o suscripciones, no se cerraron turnos, no se descargaron/restauraron backups, no se
solicitaron purgas y no se desplegó ni destruyó infraestructura.

Un prerequisito presente no equivale al cierre del gate. Los gates que exigen una operación, una
revisión humana, consentimiento o evidencia de negocio permanecen abiertos.

## Resultado ejecutivo

| Gate | Evidencia real encontrada | Estado al corte | Bloqueo verificable |
|---|---|---|---|
| OFF-6 | Implementación y pruebas OFF-1…5; checklist manual existente | **Bloqueado por entorno** | No hay app Fly de staging; `staging.kovasuite.com` y `api-staging.kovasuite.com` no resuelven; GitHub sólo declara `Preview` y `Production`. No existe backend aislado donde crear tenants desechables y conciliar la PWA. |
| BILL-4 | Los nombres de secretos Stripe están desplegados en Fly; la política temporal tiene cobertura automatizada | **Bloqueado por entorno/credenciales test aisladas** | No hay staging, Stripe CLI no está instalado y esta sesión no tiene variables Stripe test. La presencia de secretos de producción no demuestra su modo ni autoriza usarlos. Fly también declara por nombre `STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION`; su valor no fue inspeccionado y debe confirmarse deshabilitado antes de live. |
| MKT-5 | Hay testimonios publicados y un protocolo de consentimiento | **Bloqueado por consentimiento/evidencia privada** | Git no contiene referencia no sensible a permiso, periodo y resultado verificable. No se puede inferir consentimiento ni fabricar una métrica. |
| MKT-7 profundo | Claims y SEO técnico inmediato están cerrados | **Condicionado por señal** | No existen entrevistas suficientes para páginas verticales profundas; crear páginas ahora produciría contenido no verificable. |
| OPS-1 | DNS SPF, DKIM y DMARC volvió a resolver; la evidencia del 12 de agosto confirma Gmail y cinco plantillas; workflow de recordatorios reciente verde | **Parcial** | Falta Inbox/render/enlaces/móvil/modo oscuro en Outlook y Hotmail, revisión humana y ventana de monitoreo de rebotes/DMARC. |
| OPS-2 | Dominio receptor y Cloudflare Email Routing publicados; soporte vigente centralizado en Gmail | **Bloqueado por buzón/operación** | No existe evidencia de recepción **y respuesta** de `soporte@kovasuite.com`; no debe retirarse Gmail ni cambiarse DNS/copy antes de la prueba paralela. |
| OPS-3 | Workflow de backup `31689517306` terminó verde; secretos R2/Supabase están declarados en GitHub; `pg_restore` está disponible | **Bloqueado por destino y autorización** | Falta backup seleccionado, destino Supabase fresco, autorización de restore y limpieza. Un backup exitoso no prueba restaurabilidad. |
| OPS-4 | Runbook humano de higiene de turnos | **Bloqueado por autorización y conteo** | No se consultó ni cerró el turno QA. Se necesita tenant confirmado, responsable y efectivo contado. |
| OPS-5 | Workflow de purga `31687212936` terminó verde y existen pruebas de exportación/gracia/aislamiento | **Bloqueado por tenant desechable y autorización** | Un job verde no demuestra exportación completa, solicitud, espera, purga y denegación posterior sobre un tenant integrado. |
| OPS-6 | Template y checklist beta existentes | **Bloqueado por revisión/firma** | Faltan revisión legal profesional, identidad de las partes, firma y aceptación por tenant pagado. |
| PROD-2 | Instrumento, categorías de síntesis y umbral definidos | **Condicionado por investigación** | No hay 5–10 señales independientes y consistentes por segmento. Preparar el guion no equivale a entrevistar. |

## Evidencia de infraestructura, sin secretos

- DNS público resolvió el SPF y MX de `send.mail.kovasuite.com`, el selector DKIM de Resend y las
  políticas DMARC de dominio y subdominio. No se copia la clave DKIM en este documento.
- `kovasuite.com` resolvió los MX de Cloudflare Email Routing.
- GitHub tiene ambientes `Preview` y `Production`; no aparece `Staging`.
- La organización Fly visible tiene una sola app: `pos-project-backend`, desplegada. No aparece una
  app de staging.
- Fly declara desplegados los nombres `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_STANDARD_PRICE_ID`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_DATABASE_URL`,
  `MIGRATION_DATABASE_URL` e `INTERNAL_API_KEY`. No se consultaron sus valores.
- Fly también declara `STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION`. Que el nombre exista no permite
  inferir si está activo; Billing/Operaciones debe confirmar que esté deshabilitado o retirarlo
  después del gate test-mode y antes de habilitar cobro live.
- GitHub declara los nombres necesarios para backup, correo, purga y deploy. No se consultaron sus
  valores.
- Los runs programados observados terminaron correctamente: backup `31689517306`, purga
  `31687212936` y recordatorios `31677055806`.
- La sesión local no tiene variables Stripe, correo, R2 o base de datos. Existe `backend/.env`
  ignorado por git únicamente con la lista local de administradores internos; no contiene las
  credenciales de proveedor anteriores. Están disponibles Docker, `psql`, `pg_restore`, `flyctl`
  y `gh`; faltan Stripe CLI y AWS CLI.
- El despliegue Fly observado corresponde al SHA remoto `4cc6bfe755d2b056802950bdef027bed15e10295`,
  no al commit base de este corte. Por tanto, tampoco sirve como evidencia de despliegue exacto del
  plan local.

## Comandos seguros para repetir el preflight

Estos comandos sólo consultan estado. No imprimir valores de secretos ni añadir `--show-secrets`.

```powershell
Resolve-DnsName send.mail.kovasuite.com -Type TXT -DnsOnly
Resolve-DnsName send.mail.kovasuite.com -Type MX -DnsOnly
Resolve-DnsName resend._domainkey.mail.kovasuite.com -Type TXT -DnsOnly
Resolve-DnsName _dmarc.kovasuite.com -Type TXT -DnsOnly
Resolve-DnsName _dmarc.mail.kovasuite.com -Type TXT -DnsOnly

gh api repos/ArturoFrancoMozqueda/point_of_sale/environments --jq '.environments[].name'
gh secret list --json name,updatedAt
gh run view 31689517306 --json workflowName,conclusion,headSha,jobs
gh run view 31687212936 --json workflowName,conclusion,headSha,jobs
gh run view 31677055806 --json workflowName,conclusion,headSha,jobs

flyctl apps list
flyctl status -a pos-project-backend --json
flyctl secrets list -a pos-project-backend --json
```

## Secuencia exacta para cerrar OFF-6

Prerequisitos que Operaciones debe crear y autorizar antes del drill:

1. Backend y Postgres de staging separados de producción, con rol runtime RLS y datos desechables.
2. Frontend de staging apuntando exclusivamente a ese backend.
3. Dos tenants de QA sin PII, usuarios y producto/stock controlados.
4. Navegador/SO y PWA instalada identificados; commit frontend/backend exacto registrado.

Después, ejecutar `docs/offline-qa-checklist.md` y el escenario OFF-6 de
`docs/audits/AUDIT-OFF-REMEDIATION-2026-08-13.md`: venta online de control, corte real de red,
venta offline, cierre completo del navegador, reapertura offline, restauración de red y
conciliación de orden, stock, turno, reportes e idempotencia. Registrar sólo UUID anonimizado,
request IDs no sensibles, conteos/resultados y limpieza. El gate cierra únicamente si el tenant B
no ve ni sincroniza filas del tenant A y no aparecen duplicados.

Preflight mínimo una vez creado staging:

```powershell
Resolve-DnsName staging.kovasuite.com -DnsOnly
Resolve-DnsName api-staging.kovasuite.com -DnsOnly
$env:PLAYWRIGHT_BASE_URL='https://staging.kovasuite.com'
cd frontend
npx playwright test e2e/offline-sync.spec.ts --project=chromium
```

La suite automatizada no sustituye el corte físico de red y el cierre de la PWA.

## Secuencia exacta para cerrar BILL-4

1. Crear un ambiente Stripe **test** dedicado a staging, un price test y un webhook test. Guardar
   sus valores sólo en el secret store de staging.
2. Confirmar que ningún secreto empieza en live y que el frontend/backend apuntan al mismo staging.
3. Instalar Stripe CLI y verificar `stripe --version`; no autenticar esta estación contra live.
4. Crear un tenant desechable, completar checkout con método de prueba y registrar IDs test
   redactados.
5. Verificar por API/UI: `trialing/active`, renovación, `payment_failed`, gracia,
   `cancel_at_period_end`, cancelación y reanudación si está soportada.
6. Desde el Dashboard test, volver a entregar los mismos eventos y después entregarlos fuera de
   orden; comprobar watermark, `ignored` para stale, ausencia de correos/filas duplicadas y
   convergencia con Stripe.
7. Ejecutar reconciliación primero con `limit: 10`, usando `X-Internal-Key` desde un cliente seguro;
   no copiar el header a logs ni shell history. El gate falla si `failed > 0`.
8. Adjuntar timeline test redactado y limpiar únicamente el tenant/objetos test autorizados.

Checks locales previos, sin proveedor:

```powershell
cd backend
$env:UV_PROJECT_ENVIRONMENT='.venv-win'
uv run pytest app/tests/test_billing_temporal_order.py app/tests/test_billing_lifecycle.py
uv run alembic heads
```

No ejecutar BILL-4 contra `pos-project-backend` ni reutilizar secretos de producción.

## Secuencia de cierre OPS

- **OPS-1:** usar buzones QA Outlook y Hotmail, tokens inválidos y las cinco plantillas; completar la
  matriz de `docs/email-deliverability.md`. Registrar proveedor/plantilla/Inbox/render/enlace/móvil,
  nunca dirección o token. Mantener monitoreo DMARC/bounce durante la ventana indicada.
- **OPS-2:** crear y probar `soporte@kovasuite.com`, recibir y responder en ambos sentidos, observar
  rebotes y mantener Gmail en paralelo. Sólo después cambiar `frontend/src/lib/support.ts` y las
  superficies derivadas en una feature branch con rollback.
- **OPS-3:** seguir exactamente `docs/runbooks/restore-supabase-backup.md`. Primero ejecutar
  `python scripts/check_ops_readiness.py restore-preflight ...`; después del restore verificar
  roles/RLS, conteos, checksums seguros, smoke read-only y RTO/RPO. La destrucción del destino
  temporal necesita autorización separada y validación del project ref.
- **OPS-4:** seguir `docs/runbooks/shift-hygiene.md`; no automatizar el cierre. Registrar conteo y
  aprobación humana fuera de git si contiene datos operativos.
- **OPS-5:** seguir `docs/account-lifecycle.md` con un tenant desechable. Validar ZIP/CSV,
  neutralización de fórmulas, gracia mínima, cancelación, purga autorizada, acceso posterior negado
  y retención residual. No acortar 30 días para acelerar producción.
- **OPS-6:** completar `docs/runbooks/ops-beta-gate.md` por tenant y conservar firma/PII fuera de
  git. La revisión debe ser profesional; este repositorio no emite una conclusión legal.

## Secuencia de cierre MKT-5, MKT-7 y PROD-2

1. Reclutar pilotos en el sistema privado autorizado y obtener consentimiento separado para notas,
   audio y cita.
2. Ejecutar el guion conductual de `AUDIT-PROD-REMEDIATION-2026-08-13.md` sin mostrar primero una
   solución ni prometer alcance/fecha.
3. Versionar sólo síntesis categórica con `pilot_code`; nunca nombre, contacto, tenant, importes o
   texto libre.
4. Para PROD-2, no abrir especificación hasta reunir 5–10 señales consistentes **por segmento** y
   documentar una decisión `no abrir`, `seguir investigando`, `especificar alcance mínimo` o
   `rechazar por anti-fit`.
5. Para MKT-5, conservar el permiso privado y versionar únicamente su referencia no sensible,
   contexto, periodo y resultado trazable. No publicar una cifra no demostrable.
6. Para MKT-7 profundo, derivar cada página de evidencia de entrevistas y contenido específico;
   no usar generación programática delgada.

## Conclusión

No hay base verificable para marcar estos gates como **Cerrados**. Sí quedaron cerrados los
preflights de DNS, presencia nominal de secretos y salud reciente de workflows programados. Los
bloqueos restantes son concretos: staging inexistente, credenciales/herramientas test aisladas
ausentes, operaciones que requieren autorización humana y evidencia comercial/consentimiento que
no existe en git.

## Actualización posterior al corte — 2026-08-14

El propietario autorizó explícitamente despliegues y cambios en producción. Se configuraron en
GitHub los secretos de Vercel necesarios y un tenant dedicado para smoke autenticado read-only; no
se habilitaron ventas de smoke. La autorización operativa no elimina los otros prerequisitos: crear
staging requiere aprobar un costo nuevo, y MKT-5/PROD-2/OPS-6 siguen necesitando consentimiento,
investigación o revisión profesional que no puede generarse desde el repositorio.
