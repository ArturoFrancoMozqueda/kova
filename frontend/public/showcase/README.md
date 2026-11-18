# Capturas reales para marketing

## Landing vigente (18 de noviembre de 2026)

La landing usa `current/{register,inventory,shifts,reports,dashboard}.jpg` y sus equivalentes
en `current/mobile/`. Son capturas del frontend actual con los componentes y la
navegación de la app, alimentados por respuestas locales de ejemplo. No son
métricas de producción ni capturas de un negocio real. El hero combina Caja de
escritorio y Panel móvil con marcos CSS; el recorrido y la sección del Panel usan
`ProductCapture` para elegir la imagen apropiada al ancho de pantalla.

Para regenerar, levantar el frontend local y ejecutar desde `frontend/`:

```sh
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
# En otra terminal:
node scripts/capture-landing.mjs
```

Requiere Node 24 y Chromium de Playwright. El script admite únicamente localhost
o 127.0.0.1, intercepta todas las rutas API, rechaza peticiones desconocidas y
escrituras, oculta la cuenta de ejemplo y espera fuentes e imágenes. Conserva
la venta de $186 en Caja y el efectivo esperado de $2,040 en Turnos. Revisar las
diez imágenes antes de integrar un cambio de interfaz. `KOVA_CAPTURE_SCREENS=dashboard`
limita la captura a las dos vistas del Panel. No necesita secretos.

Las imágenes siguientes se conservan para otras superficies de marketing;
la landing ya no usa `kova-laptop-mobile.webp` ni `analysis-story.jpeg`.

## Archivo histórico: capturas anteriores y captura autenticada

Lo siguiente documenta el flujo anterior; sus imágenes y demo ya no se usan en la landing vigente.

`register.png`, `sale-register.jpeg`, `inventory.png`, `inventory-story.jpeg`, `shifts.png`, `reports.png` y `analysis-story.jpeg` son capturas sanitizadas del producto real. Incluyen el AppShell vigente; no se deben envolver en una réplica manual de la navegación.

`sale-register.jpeg`, `inventory-story.jpeg` y `analysis-story.jpeg` se usan en los pasos “Venta”, “Inventario” y “Análisis” del recorrido de la landing. La sección “Respuestas, no ruido” también usa `analysis-story.jpeg`, que muestra la vista actual de Análisis. Los assets PNG permanecen como las capturas de las demás secciones.

La captura de Caja se usa de forma estática en el hero. La única experiencia operable está en “Kova en acción”, usa estado y activos locales y muestra explícitamente `Demo interactiva · No registra ventas`.

Para regenerar las imágenes, desde `frontend/` define `KOVA_CAPTURE_EMAIL` y `KOVA_CAPTURE_PASSWORD` sólo como variables de entorno y ejecuta `npm run capture:showcase`. `KOVA_CAPTURE_BASE_URL` apunta a `http://localhost:5173` por defecto. Para una auditoría productiva de sólo lectura también se requiere `KOVA_CAPTURE_ALLOW_PRODUCTION=1`.

El script:

- conserva el AppShell completo y oculta el área de cuenta;
- prepara localmente, sin cobrar, Cold brew + Capuchino mediano + Yogurt con granola y espera el total calculado con los precios reales;
- bloquea cualquier request de escritura después del inicio de sesión (la telemetría se descarta para no contar la captura como uso);
- marca como vistos los recorridos de primer uso, que sólo viven en `localStorage`, para que no tapen Caja;
- espera encabezados, fuentes e imágenes antes de capturar;
- rechaza correos visibles y valida el tamaño exacto de cada vista;
- captura escritorio (1440×900) en `showcase/` y teléfono emulado (390×844, DPR 3, táctil) en `showcase/mobile/`; `KOVA_CAPTURE_DEVICES=desktop` o `mobile` limita la corrida;
- extrae a `products/` las fotografías usadas por la demo local.

Antes de publicar, revisar visualmente las cuatro capturas. No deben contener correos, nombres de personas, identificadores privados ni datos de clientes. Nunca pulsar `Cobrar`, `Cerrar turno`, `Ajustar`, `Aplicar` ni ninguna acción de escritura durante la captura.

Las capturas de 2026-10-23 se tomaron en producción, sólo lectura, desde el navegador integrado: escritorio a 1440×900 (`*.png`), historias de la landing a 3200×1800 (`*-story.jpeg`, `sale-register.jpeg`) y teléfono a 1125×2436 en `mobile/`. La carpeta `mobile/` aún no está conectada a la landing.
