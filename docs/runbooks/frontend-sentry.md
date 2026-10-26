# Sentry del navegador

El frontend usa el proyecto de navegador existente de Sentry. El DSN público de ingestión
se obtiene en Settings → Projects → proyecto del frontend → Client Keys (DSN). No es un
token de administración y no requiere crear claves, usuarios ni permisos nuevos.

En el proyecto Vercel que prepara el candidato del pipeline, guardar `VITE_SENTRY_PUBLIC_DSN`
como **Config**, en los entornos Production y Preview. El pipeline toma esta configuración
al compilar y publica los mismos archivos validados en Cloudflare. No guardar tokens privados
en variables `VITE_*` ni incluir un password de DSN deprecado.

La compilación valida este valor y lo aplica tanto al cargador diferido como a la inicialización
existente del SDK. Si falta, mantiene compatibilidad con un `VITE_SENTRY_DSN` válido. Sin ambos,
los builds locales/de pruebas permanecen sin Sentry. Un valor configurado inválido bloquea el
build sin imprimirlo. No se suprimen errores para simular observabilidad funcionando.

El incidente del 26 de octubre de 2026 se detectó como `Invalid Sentry Dsn`. La variable anterior
estaba guardada como Secret; esa clase de valor no se recupera al preparar el build local del
pipeline. Vercel impide convertirla en Config en sitio. La variable pública explícita permite
corregirlo conservando la configuración anterior, sin eliminar ni revelar secretos.

Antes de cerrar una publicación:

1. Comprobar los gates del commit y publicar mediante el pipeline con recuperación habitual.
2. Confirmar frontend/API y cargar el bundle nuevo mediante la actualización segura de la PWA.
3. Comprobar que desaparece `Invalid Sentry Dsn`.
4. Enviar un único evento de aceptación sin datos personales desde el SDK del frontend y
   comprobar en Sentry proyecto, entorno `production` y release del build publicado.
5. Mantener las opciones existentes de privacidad y ausencia de muestreo de transacciones.

El backend conserva su configuración independiente. Esta corrección no activa WhatsApp,
correo, pagos ni otros proveedores externos.
