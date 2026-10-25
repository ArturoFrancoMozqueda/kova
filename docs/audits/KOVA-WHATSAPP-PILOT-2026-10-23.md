# WhatsApp: primer corte de conexión asistida

Fecha: 2026-10-23. Fuente: copia de trabajo local, sin commit/release de esta entrega.
La visión comercial completa continúa abierta. No se configura una cuenta ni se activan envíos
productivos con este cambio. El propietario confirmó que sólo tiene la app del celular.

## Resultado y archivos

- `backend/app/messaging/connections.py`: registro de plataforma acotado en Secret store,
  resolución exclusiva tenant/sucursal/binding y estado privado sin credenciales.
- `delivery.py`, `router.py`, `webhooks.py`: callback firmado sobre bytes originales y routing
  de lotes multicuenta por sesiones con RLS. Respuestas humanas requieren confirmación explícita,
  autor que sigue asignado, gates vigentes y procesamiento sin reintentos ambiguos.
- `service.py`, `schemas.py`: borrador del catálogo publicado generado en servidor, teléfono del
  contacto sólo en proyección privada autorizada y paginación reciente opcional. El orden por
  defecto de la API anterior se conserva. Atención humana no habilita el scheduler para enviar.
- `provisioning.py`, `backend/scripts/provision_whatsapp.py`: verificación de número bajo WABA,
  operador privilegiado fuera de HTTP, autorización de miembro activo por sucursal y auditoría.
  El runtime sigue sin INSERT/UPDATE de bindings; no hay migraciones ni tablas nuevas.
- `backend/app/config.py` y `deploy/cloudflare-native/settings-keys.json`: configuración
  opcional explícita, interruptor global, activación por conexión y límite diario conservador.
  El envío se habilita únicamente en el proceso nativo; el respaldo Workers no intenta usar
  sockets HTTPX. No se cambian secretos o flags de despliegue de una cuenta real.
- `frontend/src/messaging/{InboxView,ChannelsView}.tsx`: búsqueda/vínculo explícito, ficha de
  cliente e inicio de pedido, catálogo como borrador, confirmación de envío y estados reales.
  La bandeja consulta cada 15 s estando visible y online; conserva el texto que se está preparando.
- Excepción CSRF sólo para el callback firmado; sesiones de usuario conservan cookies/CSRF.
  Logs/Sentry redactan tokens de verificación y firma; HTTPX no registra URLs de cuentas a INFO.
- Contratos, pruebas de UI/backend/navegador y guía operativa acompañan el cambio. Los cambios
  preexistentes de menú público, storefront y contenido de marketing se mantienen separados.

## Validación local

- Backend focal ampliado: **117 pruebas aprobadas** de mensajería nueva/existente, CRM,
  observabilidad y CSRF con PostgreSQL real/psycopg. El nuevo archivo tiene **20 casos**.
- Controlador pg8000 1.31.5: **75 pruebas aprobadas** de protocolo, bandeja y recorrido nuevo.
  Incluye ingreso HTTP con `SET LOCAL ROLE kova_app`, scope RLS efectivo y aislamiento de cuentas.
- Frontend focal: **19 pruebas aprobadas** en EngagementViews y ChannelsView.
- Suite frontend completa: **1,391 aprobadas y dos fallidas**, en 195 archivos. Los dos fallos
  se reproducen ejecutando sólo `AuthContext.identity.test.tsx`: el constructor nativo de Request
  rechaza un AbortSignal del entorno DOM. Ocurren en la preparación del Request; los archivos de
  autenticación, configuración de pruebas y esas expectativas no cambiaron. No se declara verde
  la suite general ni se ajustan pruebas para ocultarlo. Runtime local Node 24.19.0/Vitest 3.2.7.
- Chromium sobre build: **7 recorridos aprobados**, tres nuevos conectados en 1440/390/320 px y
  cuatro existentes en 1440/768/390/320 px. APIs interceptadas; axe A/AA sin infracciones detectadas,
  sin overflow horizontal. Capturas locales revisadas en escritorio y móvil.
- Controlador nativo: **21 pruebas aprobadas**, incluida proyección opcional de la configuración.
- TypeScript, ESLint completo, Ruff focal y `git diff --check` aprobados. Build Vite, SSR/prerender,
  contrato OpenAPI y guard de imports E2E aprobados. Vite conserva advertencia de chunk circular
  vendor/vendor-react; no se convierte en una afirmación de aceptación productiva.

Los protocolos de Meta se prueban con transportes simulados explícitos. En una primera ejecución
negativa, la doble inyección de CSRF del cliente de pruebas evitó simular la ausencia del header y
se produjo una petición con credenciales/identificadores sintéticos a Graph, rechazada con 401.
Se corrigió el caso negativo usando un header explícitamente incorrecto y se agregó un guard que
impide construir un proveedor sin transporte simulado en estas pruebas. No se usaron credenciales
reales ni se enviaron mensajes a personas. Las corridas finales usan los transportes falsos.

## Pendientes y aceptación

La [guía de alta asistida](../runbooks/whatsapp-assisted-pilot.md) describe preparación de Meta,
Secret store, publicación, challenge/suscripción, verificación de recepción/entrega y retirada.
Faltan app/activos de Meta, número de prueba, permisos, configuración y aceptación real, además
de resolver los dos fallos de la suite general antes de considerar el candidato listo para release.

Este corte no completa Embedded Signup, coexistencia, cambios de número, historial previo,
plantillas aprobadas, campañas, IA ni envíos programados de postventa. Avisos de pedido desde
tareas siguen siendo borradores que requieren intervención explícita. La ampliación de plantillas,
dispatcher durable y relación entre postventa y mensajes requiere otro corte con aceptación propia;
tener un adaptador o completar tareas internas no acredita esas capacidades.
