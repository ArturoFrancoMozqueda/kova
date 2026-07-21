# Capturas del producto para marketing

Estas imágenes muestran vistas reales de Kova sin el sidebar ni información de cuenta. La Caja no usa una captura: comparte sus componentes presentacionales con la aplicación.

Para regenerarlas, usa un tenant local con datos sembrados y ejecuta `npm run capture:showcase` definiendo `KOVA_CAPTURE_EMAIL` y `KOVA_CAPTURE_PASSWORD`. `KOVA_CAPTURE_BASE_URL` es opcional y apunta a `http://localhost:5173` por defecto.

El script rechaza correos dentro del área capturada y bloquea producción salvo autorización explícita mediante `KOVA_CAPTURE_ALLOW_PRODUCTION=1`. Revisa visualmente cada PNG antes de publicarlo.
