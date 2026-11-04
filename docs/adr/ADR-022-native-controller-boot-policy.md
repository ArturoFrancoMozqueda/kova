# ADR-022: Verificar la configuración de arranque del controlador nativo

## Estado

Decisión de despliegue del 2026-11-04. Complementa
[ADR-021](ADR-021-commercial-production-activation.md): conserva la autorización comercial y
añade una baseline preparatoria OFF antes de repetir la activación. No acredita por sí sola
una publicación ni cambia acuerdos, precios de Stripe, base de datos o credenciales.

## Contexto

El PR #316 aprobó CI y se fusionó, pero su
[release 41772733388](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/41772733388)
falló en candidato porque el catálogo público no coincidió con la oferta revisada. La recuperación
completó y la comprobación independiente confirmó frontend, API, proxy y base en la baseline
`7032d21f60aa`, con oferta Standard/OFF. No se acepta ese intento como activación productiva.

La reproducción aislada demuestra un defecto compatible con el incidente: una imagen nueva puede
arrancar bajo el controlador anterior y conservar sus variables de entorno. El controlador nuevo
puede encontrar el proceso saludable y aceptar su SHA sin aplicar su propia configuración. Repetir
la prueba de puertos tampoco reconfigura un proceso que el SDK ya considera en ejecución. Esto
demuestra el defecto, sin identificar por sí solo la causa exclusiva del incidente productivo.

Cloudflare documenta que los cambios de variables requieren un nuevo arranque del proceso:
[variables y secretos de Containers](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/).

## Decisión

1. El controlador deriva `KOVA_BOOT_CONTROLLER_SHA` de su SHA completo de build. No acepta el
   marcador de una solicitud ni de la proyección de Settings. Las identidades de imagen siguen
   siendo propiedad de la imagen; este marcador no las sustituye ni modifica.
2. El proceso captura ese marcador al arrancar y lo devuelve como
   `x-kova-boot-controller-sha` únicamente en una respuesta exitosa de `/health`. Omite valores
   ausentes o inválidos y elimina headers homónimos preexistentes. No devuelve configuración,
   huellas de secretos, credenciales ni identificadores de clientes.
3. Antes de admitir tráfico, el controlador verifica la imagen y la identidad de arranque.
   Comparte la comprobación entre solicitudes concurrentes y conserva su resultado para el
   proceso verificado. Un reinicio o fallo de transporte invalida la comprobación.
4. Una imagen esperada con configuración anterior exige detener el proceso mediante la API
   pública del SDK y comprobar la parada antes del nuevo arranque. `stop()` envía SIGTERM;
   no demuestra que el proceso ya terminó. Mientras tanto se devuelve 503, sin repetir la
   solicitud de negocio, destruir almacenamiento ni iniciar un bucle de reinicios.
   Además, el proceso rechaza antes de abrir HTTP un marcador presente que no coincida con
   su imagen inmutable. Esto cierra la ventana en que el SDK podría arrancar otro proceso entre
   la comprobación y el envío de una escritura. Solo la ausencia legacy se tolera durante el
   bootstrap OFF; no acredita aceptación del nuevo controlador.
5. El release exige también el marcador en el candidato y la aceptación pública. Ausencia legacy
   o marcador de la baseline anterior no son aceptación: solo pueden esperar convergencia dentro
   del presupuesto existente. Valores malformados o ajenos fallan cerrados. La recuperación
   conserva compatibilidad con baselines antiguas que no emitían el header.
6. Publicar primero el protocolo con nuevas ofertas y Portal OFF y gate Standard. Durante esa
   preparación, la baseline anterior y la nueva conservan la política comercial OFF. Tras release
   aprobado y verificación externa, capturar esa baseline para una activación ON separada. Así,
   tanto el controlador de activación como el de recuperación entienden el nuevo protocolo.

## Validación y límites

Las pruebas deben cubrir continuidad del proceso entre controlador viejo, imagen nueva y
controlador nuevo; recorrido inverso de recuperación; solicitudes concurrentes; parada pendiente;
marcadores ausentes, inválidos o ajenos; arranque correcto y ausencia de reinicio al recuperar
un controlador con marcador coincidente. El transporte HTTP debe conservar cookies, cuerpo y
las identidades anteriores, sin aceptar un marcador proporcionado por el cliente.

No se amplían tiempos, intentos o permisos, ni se retiran los gates de catálogo, identidad,
base de datos o recuperación. La aceptación sandbox de Stripe conserva su alcance por etapa.
El marcador identifica el build del controlador; no es una huella de todos los bindings ni
detecta una edición de configuración bajo el mismo SHA. Un cambio que deba reaplicarse al
proceso residente requiere un nuevo release revisado con SHA distinto, sin exportar secretos.
Cobro live controlado, riesgos live, MFA de Ops, fiscal, hardware y recuperación regional siguen
requiriendo su propia evidencia.
