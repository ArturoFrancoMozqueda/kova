# Navegación por rol con accesos diarios y categorías desplegables

Fecha: 2026-10-27, Ciudad de México.
Riesgo: comportamiento/UI frontend y preferencias locales; no cambia contratos, permisos,
base de datos, facturación ni sesión. Publicación autorizada por el propietario.
El control de publicación exige además actualizar una dependencia vulnerable del backend;
se limita a dnspython 2.8.0 → 2.9.0 en el lock nativo, sin modificar código ni contratos.

## Problema y comportamiento implementado

Las tareas secundarias aparecían sólo después de navegar a una categoría. El usuario debía
deducir dónde estaba cada función y la barra repetía nombres entre categorías y destinos.

- Caja, Pedidos y Ventas quedan al principio, con Panel adicional para dueño y gerente.
  El grupo fijo queda fuera del desplazamiento de categorías. El pie móvil usa los tres
  accesos diarios y Más; no sustituye Ventas por Panel o Turnos.
  En ventanas de hasta 700 px de alto se desplaza todo el menú para que las categorías
  sigan siendo alcanzables; se prueba 320×568 con Pedidos habilitado para los cuatro roles.
- Menú y ventas, Clientes y atención, Productos y operación, Análisis y finanzas y
  Configuración tienen botones con flecha, estado accesible y panel asociado. Abrirlos no
  cambia la ruta ni dispara consultas de las pantallas contenidas.
- La ruta actual abre su categoría, incluso con enlace directo. Las otras categorías
  conservan su estado; se puede cerrar la actual hasta la siguiente navegación.
- Las preferencias usan `kova-navigation-groups-v2:<tenant>:<user>:<role>`, sólo con IDs
  de categoría y booleanos. Lectura corrupta o almacenamiento no disponible no bloquean
  navegación. La clave anterior se ignora sin alterar otros ajustes. No se guardan tokens.
- Los grupos con una sola opción son enlaces directos. Cajero y colaborador ven la lista
  corta autorizada de Caja/Pedidos/Ventas/Turnos/Clientes, sin categorías vacías ni enlaces
  de configuración, reportes o inventario que no les corresponden.
- Pedidos conserva feature flag y permiso; offline continúa limitado a Caja. Lealtad
  permanece sólo para dueño, Suscripción con su permiso y Asistente con su capacidad.
- La barra compacta muestra flechas y nombres accesibles. Abrir un grupo expande la barra,
  conserva foco y ruta. En móvil, expandir conserva el drawer y elegir destino lo cierra
  devolviendo el foco al disparador. Los enlaces tienen área mínima de 44 px.
- Búsqueda y continuaciones conservan las mismas rutas y filtros. Casos de atención y
  Seguimientos de postventa distinguen las dos tareas antes llamadas Postventa.

## Archivos y revisión

- `frontend/src/layout/AppShell.tsx`: composición por rol, accesos fijos y pie móvil.
- `NavigationGroups.tsx`: estado, persistencia, apertura y semántica accesible.
- `workspaceNavigation.ts`: destinos agrupados y validación de preferencias.
- `frontend/src/i18n/messages.ts`: nombres de los dos destinos de atención/postventa.
- Pruebas de layout y E2E de barra, móvil, asistente y continuidad comercial. Las
  expectativas cambian porque el propietario pidió reemplazar la navegación contextual
  por desplegables. Se conservan las aserciones de permisos, foco, rutas, datos y dinero.

Se aplican las guías de React y verificación: filtros antes de componer, categorías sin
peticiones adicionales, estado derivado de rutas y preferencias sin material de sesión.
No se cambia la disposición de impresión ni se agregan transformaciones al contenido.

## Validación

- Frontend completo: **1,669 pruebas aprobadas en 217 archivos**.
- Navegador sobre build: **348 escenarios aprobados**, incluidos 320×568 para los cuatro roles. Las 20 integraciones se omiten en
  ese modo y se ejecutan por separado, sin interceptar APIs.
- Integración real completa: **20 recorridos aprobados**, incluido menú a seguimiento,
  pedido/cobro/entrega/postventa, abastecimiento, clientes/citas y aislamiento.
- Aceptación adicional por rol: **cuatro recorridos aprobados** en los cuatro tamaños.
- TypeScript/build/SSR/prerender, ESLint, contrato OpenAPI, guard de imports E2E y revisión
  de bundle: aprobados; 128 archivos JS sin patrones de secretos detectados.

La aceptación adicional por rol usa cuatro cuentas en un negocio efímero y API/PostgreSQL
reales, sin interceptar APIs: login, Caja/Pedidos/Ventas, apertura sin cambio de ruta,
continuación a Clientes, ausencia de inventario/configuración prohibidos y rechazos API
para empleados/CRM. Se ejecuta en 320/390/768/1440 px, sin crear ventas ni modificar maestros.

El navegador de Codex comprueba además la sesión de propietario, apertura de categorías,
permanencia de la página y composición real. Las suites cubren teclado, drawer, Escape,
foco, compactación, persistencia, almacenamiento corrupto, búsqueda, rol y offline.
Se corrigió un selector del recorrido comercial que aún buscaba el nombre anterior
Atención postventa; la expectativa ahora usa Casos de atención y conserva todas las
comprobaciones financieras. El set real completo se repitió y pasó con la versión final.

## Publicación y aceptación productiva

Requiere `CI required`, captura exacta de reversión y publicación coordinada existente.
Después se verifican SHA de frontend/API, salud de base/proxy y la navegación del dueño
en la sesión productiva. La comprobación productiva es de lectura y preferencias de UI;
no necesita crear ventas, pedidos, empleados ni cambiar el catálogo restaurado.

El primer control de dependencias detectó CVE-2026-114605 en dnspython 2.8.0.
Se actualiza sólo ese paquete y sus hashes con uv 0.13.4; el lock de Cloudflare Free
ya usa 2.9.0. El [aviso del mantenedor](https://github.com/rthalley/dnspython/security/advisories/GHSA-45c3-73f7-pv4m)
confirma la versión corregida. La auditoría local vuelve a pasar sin vulnerabilidades
conocidas; se requieren las suites de backend y seguridad en el nuevo CI antes de fusionar.
