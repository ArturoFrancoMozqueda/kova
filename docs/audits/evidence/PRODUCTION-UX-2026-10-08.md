# QA productiva de UX y accesibilidad — 2026-10-08

Base: `origin/main` después de integrar PR #182. Sitio revisado: `https://kovasuite.com`.
La sesión de esta revisión pública no usó credenciales ni modificó registros productivos.
La inspección autenticada la realizó el agente coordinador con la cuenta autorizada.

## Correcciones verificadas

| Hallazgo | Corrección | Evidencia |
| --- | --- | --- |
| El diálogo no capturaba foco al abrir desde cerrado y reiniciaba el foco cuando cambiaba un callback inline. | Esperar el montaje real del panel y mantener el handler vigente en ref sin reiniciar el efecto de foco. | Dos regresiones fallaron antes. Pasan después, junto con pruebas de trap Tab, Escape, devolución de foco y animación de salida. Chrome local a 390px permite escribir una nota completa y devuelve foco al trigger con Escape. |
| Gastos mostraba $0.00 antes de recibir datos y conservaba el total anterior cuando fallaba la consulta del nuevo periodo. | Mostrar el resumen únicamente después de recibir los datos sin error. | Dos regresiones fallaron antes y pasan después; se preservan orden de respuestas y fechas del negocio. |
| Login y registro mantenían el título de landing en la pestaña. | Usar el hook existente de título y restaurar el título público al volver a Home. | QA productiva pública confirmó el título incorrecto en ambas rutas. Pruebas de títulos y Chrome local confirman el resultado corregido. |
| El enlace público «Ir al contenido» cambiaba el fragmento pero dejaba el foco en BODY. | Hacer el main destino focusable con tabIndex=-1. | Chrome productivo: BODY después de Tab → Enter. Chrome local corregido: MAIN#contenido-principal, sin parada extra de Tab. |
| Clientes carecía de main/role=main y título propio. | Usar ViewLayout y el hook de título. | Evidencia productiva autenticada del coordinador, verificada en código; regresión comprueba landmark y título. |

## Cobertura productiva pública

Rutas `/`, `/login`, `/signup`, `/forgot-password`, `/privacy`, `/terms`, `/seguridad`, `/cookies`.
Cada ruta se revisó en 320, 390, 768 y 1440px: **32 recorridos**, HTTP 200, sin overflow
horizontal y sin errores JavaScript. Axe WCAG 2 A/AA y 2.1 AA no reportó violaciones en estos
recorridos con movimiento reducido. El CSP se omitió únicamente en el contexto de la herramienta
QA para inyectar axe, sin modificar el sitio ni su política.

Robots, sitemap, manifest PWA, service worker, OG PNG y los dos favicons respondieron 200 con sus
tipos esperados. Las anclas de landing resuelven destinos existentes. El menú móvil abre y cierra
con Escape. El enlace a términos desde registro abre una nueva pestaña con noopener noreferrer.
Las rutas privadas y legales observadas conservaron noindex; landing conservó su canonical.

## Validación local

Las suites vigentes de Dialog, ConfirmDialog, ExpensesView, AuthView, Home, CustomersView,
AssistantView y AssistantCompanion suman **79 pruebas aprobadas**. TypeScript y ESLint de los diez
archivos modificados aprobaron. Pruebas de API y permisos existentes no cambiaron.

La QA local del formulario de gastos utilizó respuestas de prueba exclusivamente en el navegador
local; no se añadieron datos ni fallbacks de demostración al código productivo. No se crearon
ventas, gastos o clientes en producción para verificar estas correcciones.

## Límites

Axe y Chrome headless no sustituyen una revisión manual completa de VoiceOver/NVDA, Safari/iOS ni
una medición de rendimiento con usuarios reales. No se verificaron compras Stripe live, entrega de
correo, soporte por WhatsApp, instalación PWA en un dispositivo físico ni todos los estados de
red en esta sesión. La cobertura autenticada y la publicación de las correcciones pertenecen a
la evaluación y verificación final del coordinador.

## Ampliación con evidencia autenticada

La revisión autenticada posterior del coordinador encontró títulos heredados de landing en
Asistente e Integraciones. Se añadieron sus títulos con el hook existente; 17 pruebas de esas
vistas, TypeScript y ESLint aprobaron. Dashboard ya tenía su hook de título y se preservó.

Axe productivo encontró color-contrast serio de 2.36:1 en badges de pedidos pagados/entregados,
turnos y suscripción, además de 2.26:1 en la cola de sincronización. El origen común era la variante
success de Badge con texto verde #1EBF8A; se conservó la superficie y se usó emerald-700 para el
texto. Una regresión Chrome móvil a 390px reprodujo los mismos dos nodos productivos de pedidos
antes del cambio y pasó sin violaciones color-contrast después.

Dashboard también tenía términos/descripciones anidados un nivel adicional bajo dl/div/div.
Una regresión axe local reprodujo definition-list y dlitem; se corrigieron a dl/div/dt + dd,
conservando cifras y distribución visual. La regresión y las pruebas de cola de sincronización
aprobaron: ocho pruebas unitarias más un recorrido Chrome, TypeScript y ESLint.

## Etiquetas de ventanas móviles de ventas

El coordinador concilió datos productivos: el preset llamado «Mes» consultaba Sep9–Oct8 y no
Oct1–Oct8; la consulta «este mes» del asistente usaba correctamente el mes calendario. Se
preservaron rangos y cálculos del POS y se corrigió la presentación de ventanas móviles en
Reportes y Panel: «7 días»/«30 días», «Últimos 7/30 días» y comparaciones con los 7/30 días
anteriores. El hero ahora valida las fechas del preset para llamar «Este periodo» a rangos
históricos personalizados, en lugar de asumir que cualquier ventana de 28–31 días es este mes.

Tres nuevas regresiones prueban Oct8 → Sep9–Oct8, comparación Aug10–Sep8 y un rango histórico
Jun1–Jun30. Las suites Reportes/Panel/fechas aprobaron 29 pruebas. Además, dos recorridos Chrome
local con Reportes poblados (ventas, productos, horarios, margen y gastos), a390 y1440px, pasaron
axe WCAG A/AA sin violaciones. TypeScript y ESLint aprobaron. Los datos de esos recorridos fueron
respuestas controladas exclusivamente por el navegador de pruebas, sin cambios de datos ni
fallbacks en producción.

## Cierre: roles de empleados y gráfica de rangos largos

La selección de rol de cada empleado carecía de nombre accesible; la invitación ya tenía su
label/id asociado. Se añadió «Rol de {correo}» a los controles individuales. La prueba identifica
por rol y nombre tanto invitación como edición y confirma que cambiar la selección requiere
revisar el diálogo antes de guardar el nuevo permiso.

La gráfica de ventas truncaba silenciosamente cualquier rango a sus primeros 31 días. Se retiró
ese límite de presentación y se conservó todo el rango recibido, con el scroll horizontal
existente. La regresión de 45 días falló antes (31 puntos) y pasa después, incluyendo la venta de
$1,250.00 del último día como punto seleccionable. Los totales y consultas del reporte no cambian.

Las cuatro suites afectadas aprobaron 21 pruebas; TypeScript y ESLint aprobaron. Estos cambios
cierran la revisión delegada de UX; la publicación y QA productiva final siguen a cargo del
coordinador.
