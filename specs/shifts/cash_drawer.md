# Cajón de dinero desde cualquier navegador

## Alcance autorizado (2026-10-09)

El propietario pidió compatibilidad con el cajón de dinero y operación desde cualquier equipo.
La implementación permite solicitar aperturas desde Kova en Windows, macOS, Linux, Android e
iPadOS mediante la API existente de Kova. El equipo móvil no necesita acceso USB ni Web Serial.
La comprobación física de modelos concretos y la publicación en producción están pendientes.

Un conector Python 3.12+, sin dependencias adicionales, se ejecuta en un equipo Windows/macOS/Linux
en la misma red que una impresora ESC/POS con puerto TCP RAW y un cajón compatible conectado a
su salida. Este alcance **no incluye impresoras exclusivamente USB/Bluetooth, cajones USB
directos ni apertura remota sin internet**. El navegador puede estar en cualquier red con acceso
a Kova; el conector necesita acceso a internet y a la impresora local. No se contrata un proveedor
externo ni se agrega un precio o plan.

## Experiencia y contratos

- Configuración → Recibo: nombre, salida 1/pin 2 o salida 2/pin 5, vinculación, prueba, apertura al
  cobrar y revocación. Un conector/cajón por sucursal; la selección de sucursal ya existente aplica.
- La apertura automática comienza desactivada. Primero probar el equipo, después activarla.
- Caja y cobro de pedidos: apertura después de confirmar una venta reciente con efectivo positivo,
  incluso pago dividido. Fallar al abrir nunca revierte, duplica ni vuelve a cobrar la venta.
- Caja: botón de apertura manual con motivo, limitado a quienes pueden abrir turnos y a un turno
  abierto. La apertura física no representa una entrada/salida de efectivo ni altera el corte.
- Imprimir/reimprimir tickets y sincronizar ventas antiguas no genera órdenes de apertura.
- Las ventas guardadas offline conservan su funcionamiento; requieren llave para el cajón.
- “Orden enviada” confirma envío del pulso, **no** un sensor de apertura física.

Endpoints aditivos bajo `/api/v1/hardware`:

| Ruta | Autorización / efecto |
|---|---|
| GET `/drawer` | Sesión por cookies; estado de la sucursal activa sin credenciales |
| POST `/drawer/setup` | `settings.manage` + acceso comercial; vinculación o renovación |
| PATCH `/drawer` | `settings.manage` + acceso comercial; guarda sin rotar credencial |
| DELETE `/drawer` | `settings.manage`; revoca incluso si el negocio perdió acceso comercial |
| POST `/drawer/open` | `orders.create` + comercial; manual además `shifts.open`; prueba además `settings.manage` |
| GET `/drawer/commands/{id}` | Sesión; pertenencia a tenant/sucursal |
| GET `/connector/download` | Script público sin datos ni credenciales de negocios |
| POST `/connector/pair` | Código aleatorio de un solo uso; 10 minutos |
| POST `/connector/poll` | Credencial dedicada del conector + comercial; entrega una orden como máximo |
| POST `/connector/commands/{id}/ack` | Mismo conector; informa `sent`/`failed`, sin reejecutar |

## Seguridad y entrega física

- Las sesiones de usuarios siguen exclusivamente en cookies; CSRF y contexto de identidad/sucursal
  se conservan. La credencial del conector no permite acceder a las rutas de sesión ni emitir órdenes.
- Código y credencial: 256 bits aleatorios, hash SHA-256 en DB, sin logs/exportación. Código en
  memoria de Configuración y portapapeles cuando lo solicita el operador, sin almacenamiento del
  navegador; clave permanente solo en archivo del perfil del operador del conector.
  La clave dura 90 días y se invalida al renovar o revocar. No compartir el código ni el archivo.
- RLS habilitado y forzado en ambas tablas; FKs compuestas preservan tenant/sucursal. Ninguna
  tabla se concede a los roles Data API de Supabase. Exportación excluye hashes y códigos; purga
  elimina órdenes antes de dispositivos y pedidos/sucursales.
- La API rechaza ventas sin efectivo, sin turno actual, antiguas o de otra sucursal. El frontend de
  caja solo solicita la apertura para la venta actual confirmada en menos de 10 segundos.
- Orden con vigencia de 5 segundos; misma venta/solicitud no crea duplicados; un lock del dispositivo
  serializa despacho/renovación/revocación. Dos aperturas diferentes en menos de 2 segundos se rechazan.
- Despacho se confirma en DB **antes** de responder al conector; respuesta perdida nunca redespacha.
  El conector descarta respuestas demoradas y revalida plazo antes de escribir al socket. Un fallo
  parcial nunca reintenta el pulso. No se usan colas del sistema operativo que pudieran abrir tarde.
- Pulso fijo `ESC p m 50 200`: 100 ms activo, 400 ms inactivo. Solo `m=0|1`; nunca se ejecutan
  comandos, URLs o programas enviados por el navegador. Verificar el manual eléctrico del fabricante.
- Solo HTTPS saliente al backend y TCP hacia la impresora; ningún puerto local abierto al navegador.
  Redirecciones HTTP se rechazan para no reenviar credenciales. No se desactiva TLS ni CSP.
- La entrega es como máximo una vez. Una pérdida de respuesta/ACK puede dejar el resultado incierto;
  revisar físicamente y usar la llave antes de solicitar otra apertura. La impresora también puede
  tener su propio procesamiento/buffer; debe verificarse con el modelo real.

## Instalación y QA física pendiente

1. Aplicar migración `0078_drawer_bridge` y grants antes de desplegar el backend; después frontend.
   No borrar las tablas en rollback si contienen historia: conservar la migración y revertir app.
2. Elegir sucursal y abrir Configuración → Recibo → Cajón de dinero. Descargar el conector y generar
   código; el conector previo deja de recibir órdenes al renovar.
3. En el equipo de caja ejecutar `python kova-drawer-connector.py setup --host IP_DE_IMPRESORA`
   (en macOS/Linux puede llamarse `python3`). Pegar el código en el prompt privado.
4. Ejecutar `python kova-drawer-connector.py run`; mantener ese proceso y equipo encendidos. El
   puerto predeterminado es 9100; `--port` permite el puerto especificado por el fabricante.
5. Actualizar estado en Kova y probar apertura. Verificar voltaje/cable/pin/timing del modelo antes
   de habilitar automático. No certificar compatibilidad hasta registrar evidencia física.
6. Probar desde Windows/Mac, Android e iPad con ventas de QA: efectivo, dividido, tarjeta, doble
   clic, recibo/reimpresión, cambio de sucursal, sin turno, revocación, internet perdido, impresora
   apagada, recuperación y respuesta/ACK perdidos. Ninguna venta antigua debe abrir al reconectar.
7. Confirmar teclado, anuncios de estado, 390/1100/1440 px y zoom 200 %. Una orden enviada no
   acredita la apertura física; registrar modelo/conexión/OS/navegador y evidencia del cajón.

## Evidencia local

Verificación al 2026-10-09, rama `feature/cash-drawer`:

- 73 pruebas de backend: cajón, conector, conciliación, exportación/purga, redacción y RLS. Incluyen
  dos polls concurrentes con el rol runtime, rechazo de escrituras entre tenants, credenciales
  vencidas/revocadas, permisos comerciales y captura de los cinco bytes en un socket TCP real de QA.
- 45 pruebas de frontend: cobro confirmado, tarjeta, pendiente offline, confirmación tardía, pedido,
  fallo de hardware y configuración. No se reescribieron los oráculos anteriores para pasar pruebas;
  los fixtures de grants y navegador incorporan explícitamente la nueva capacidad.
- 12 escenarios de navegador (4 de cajón + 8 de caja): 390/1100/1440 px sin desbordamiento y
  apertura manual con motivo sin crear venta. Inspección visual local de configuración móvil y
  escritorio. Se usan respuestas de QA controladas; no acreditan apertura física.
- TypeScript, ESLint de archivos afectados, Ruff, build producción/SSR/prerender, secretos en bundle,
  guard de mocks, contrato OpenAPI y `git diff --check` pasan. Solo se agregan endpoints/esquemas;
  los endpoints y esquemas previos no cambian.
- PostgreSQL desechable local; sin cambios en Supabase ni producción. Migración y RLS verificados
  en ese entorno. No se ejecutaron QA física, Safari/iPad real, red de tienda, Windows/Mac reales
  con impresora ni lector de pantalla/zoom 200 %. La matriz física sigue pendiente.

Áreas cambiadas: `backend/app/hardware/`, migración 0078, registro de router/RLS, grants, grafo de
exportación/purga y redacción/no-cache; `frontend/src/hardware/`, Caja, cobro de pedidos y Recibo;
tests/fixtures correspondientes, OpenAPI y planificación. No se modificaron sesiones de usuarios,
cálculos de efectivo, pagos, offline sync ni contratos anteriores.

### Integración para merge (2026-10-09)

Se incorporó `main` hasta `c5a363a`, conservando la recuperación de cobros y el alta fiscal
administrada. La migración 0078 continúa desde `e9f2d5d835e6` para mantener una sola cabeza
Alembic. La prueba fiscal de instalación nueva ahora compara con la cabeza del grafo actual;
sus comprobaciones de esquema, RLS y datos permanecen intactas.

Revalidación local: 89 pruebas de backend (incluye privacidad de caché y migración fiscal), 49
de frontend, ESLint y build de producción/SSR/prerender pasan. CI y publicación se registran
en el PR; la certificación física continúa pendiente.

Fuentes de protocolo: [ESC/POS Epson](https://download4.epson.biz/sec_pubs/bs/pdf/ESC_POS_FAQ_00.pdf),
[conector eléctrico Epson](https://download4.epson.biz/sec_pubs/bs/pdf/EU-m30_dg_en_revD.pdf).
