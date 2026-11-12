# ADR-031: espacio aislado acotado para un candidato bloqueado

Estado: propuesto e implementado localmente; sin publicación ni aceptación productiva.
Fecha: 2026-11-11.
Complementa [ADR-030](ADR-030-independent-native-api-slots.md); no altera su protección de drenado.

## Contexto

El intento 43157159134 se recuperó al no terminar el drenado del slot inactivo en quince minutos.
La API pública conservó su SHA y proceso; WhatsApp siguió desactivado en ese proceso. La señal
booleana no permite afirmar si existe una respuesta legítima o contabilidad obsoleta. Forzar el
cierre o publicar encima de ese controlador anularía la garantía que se quiere preservar.

La versión instalada del SDK, 0.3.7, tiene un [reporte de respuestas abandonadas](https://github.com/cloudflare/containers/issues/242).
Se reprodujo localmente que una respuesta posterior al aborto conserva el contador sin cancelar
su cuerpo. La prueba falla antes de la corrección y pasa después. Esto acredita el defecto del
código, no una inspección del contador privado del namespace productivo antiguo.

## Decisión

Cancelar explícitamente el cuerpo si el cliente se desconecta antes o después de recibir sus
cabeceras. El contador sólo se libera después de que el origen acepte la cancelación. Una respuesta
con un cliente conectado sigue protegida hasta EOF; no se impone una caducidad que corte trabajo
legítimo. Se elimina el `waitUntil` separado que fijaba la vida de una respuesta ya abandonada.
Se habilita `enable_request_signal` en frontend, gateway y slots y se propaga la señal de forma
explícita. Es necesario para las fechas de compatibilidad anteriores al 17 de noviembre de 2026,
según [Cloudflare](https://developers.cloudflare.com/changelog/post/2026-11-02-request-signal-default/).
La corrección se instala únicamente en nuevos candidatos; el espacio adicional permite hacerlo
sin publicar encima del controlador ya bloqueado.

Permitir una tercera identidad fija `kova-api-recovery`, privada, con namespace independiente,
un contenedor basic y máximo una instancia. Sólo se usa como sustituto de un slot ocupado si el
snapshot v2 acredita ausencia de Worker y aplicación y se confirma de nuevo antes de crearlos.
Un recurso que aparezca entre consultas bloquea el release. No se crean nombres por intento,
no se borra el namespace antiguo y no se reutiliza un respaldo ocupado para superar la protección.

Snapshots v1 conservan su contrato de dos slots y recuperación histórica. Snapshot v2 captura
los tres, imágenes, versiones y namespace exactos. Cada candidato mantiene verificación de
BD/oferta/SHA/proceso y promoción posterior; rollback no reconstruye ni reinicia imágenes previas.
El comparador del gateway admite sólo las tres identidades revisadas y conserva estricto todo
otro binding, dominio, secreto, permiso, límite y flag.

La ampliación de opciones de alta de WhatsApp usa un Worker privado separado que delega los
ajustes comunes al holder original y sólo agrega cuatro campos de configuración explícitos.
Nunca publica el controlador/API/rate limiter existente para extender esos campos. Una vez creado,
cambiar el código de ese delegado requiere una migración separada; las publicaciones normales
comprueban su fuente. El comparador del CLI no es una dependencia runtime del holder y se retira
de su inventario de archivos; las dependencias runtime reales mantienen el guard previo.
En los slots drenados, el CLI permite una única transición revisada del binding `SETTINGS`:
`kova-backend/NativeSettings` a `kova-native-signup-settings/SignupSettings`, con slot y SHA
capturados. Cualquier otro servicio o descriptor sigue estricto. Recovery sólo puede avanzar su
SHA manteniendo idénticos los cuatro identificadores comerciales públicos; cambiar su oferta
requiere otra migración revisada.

## Consecuencias y evidencia requerida

Hay costo potencial de un tercer contenedor. Los pools de cada API siguen en tres conexiones
runtime y cuatro privilegiadas: hasta 21 para tres slots, más jobs y cualquier legado aún retenido,
dentro del techo operativo documentado de 60. No se aumenta el pool ni el máximo de instancias.
Los controladores antiguos que no reconocen recovery conservan su comportamiento de fallo cerrado
al evaluar apagado; no se actualizan por conveniencia. La capacidad extra no sustituye investigar
el drenado ni autoriza eliminar procesos que mantengan respuestas abiertas.

Pruebas: candidato libre, respaldo ya existente, aparición entre captura/publicación, identidad
ajena y lectura no disponible; ninguna modifica blue/green ni el holder. Se agrega diagnóstico
acotado de respuestas activas y tiempo inactivo a nuevos controladores. El ensayo productivo,
recuperación y observación de conexiones/costo quedan pendientes de autorización y ejecución.
