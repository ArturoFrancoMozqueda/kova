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

- [PR #285](https://github.com/ArturoFrancoMozqueda/kova/pull/285) fusionado tras
  `CI required` aprobado sobre `9a0a9a571a722d74e35e13fc184ccdd21927bbc8`.
  [CI previo](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40535268081)
  aprobó también 2,232 pruebas de backend y seis subpruebas, integración Free/PostgreSQL,
  aceptación nativa, migraciones, reproducibilidad y seguridad.
- Release `18255a3f18347a77b39da6533cbd88cc5675f7f7`, frontend `18255a3f1834`.
  [Publicación coordinada, intento 2](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/40536360148/attempts/2)
  aprobada; captura exacta de reversión conservada antes de publicar. La verificación
  independiente confirma el mismo SHA en frontend/API, sitio, base de datos y proxy accesibles.
- El primer intento recibió HTTP 429 en la aceptación de validación de login. La
  recuperación automática terminó con `RELEASE_FAILED_RECOVERED (candidate)` y restauró
  `4ae7c8f7182d4d1c624f16c4ec227f744c3d6ae4`. Se conservaron los artefactos; el verificador
  público y los 25 contratos de la versión recuperada aprobaron antes del segundo intento.
  No se cambió el control, el límite ni el código entre intentos. El 429 por sí solo no
  permite distinguir agotamiento de cuota de indisponibilidad del puente privado,
  que también falla cerrado. El segundo intento pasó sus dos aceptaciones de 25 contratos
  (máximos 634 ms y 303 ms). La comprobación independiente posterior pasó 25 contratos,
  mismo proceso, mediana 289 ms y máximo 446 ms, incluida validación de login.

Aceptación desde la sesión real de propietario de Cafetería Sweet Home en el navegador de Codex:

- Actualización desde Panel, conservando sesión y preferencias. No quedó aviso de actualización.
- Caja, Pedidos y Ventas cargan desde los accesos diarios. Caja conserva carrito vacío;
  no se crea, cobra, entrega ni devuelve ningún pedido o venta durante esta aceptación.
- Menú y ventas y Clientes y atención se abren sin abandonar Panel. Cerrarlos y recargar
  conserva la elección; entrar por enlace directo al catálogo abre sólo su categoría.
- Desde la barra compacta, abrir Productos y operación expande la barra y descubre
  Inventario manteniendo Panel. Búsqueda encuentra Catálogo público con la categoría
  cerrada, abre el destino y limpia la consulta.
- Catálogo público conserva `https://kovasuite.com/catalogo/cafeteria-sweet-home` y
  13 productos seleccionados. No se guarda ni modifica el catálogo o su enlace.
- Sin desbordamiento horizontal ni errores de consola observados. Inspección visual
  aprobada; captura local `kova-navegacion-produccion.jpg` en los artefactos del chat.

Los otros tres roles y los cuatro tamaños se validaron con cuentas/API/PostgreSQL reales
locales y cobertura automatizada. La aceptación manual productiva usa sólo al propietario;
no se afirma iniciar sesión con los otros roles en producción. No se cambiaron empleados,
permisos, datos maestros, cobros ni registros comerciales para validar la navegación.

## Dependencia corregida para publicar

El control de dependencias detectó CVE-2026-114605 en dnspython 2.8.0.
Se actualizó sólo ese paquete y sus hashes con uv 0.13.4; el lock de Cloudflare Free
ya usaba 2.9.0. El [aviso del mantenedor](https://github.com/rthalley/dnspython/security/advisories/GHSA-45c3-73f7-pv4m)
confirma la versión corregida. La auditoría local y CI pasan sin excepciones, con las
suites completas de backend y seguridad aprobadas antes de fusionar.
