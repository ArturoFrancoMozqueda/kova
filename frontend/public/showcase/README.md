# Capturas reales para marketing

`register.png`, `sale-register.jpeg`, `inventory.png`, `inventory-story.jpeg`, `shifts.png`, `reports.png` y `analysis-story.jpeg` son capturas sanitizadas del producto real. Incluyen el AppShell vigente; no se deben envolver en una réplica manual de la navegación.

`sale-register.jpeg`, `inventory-story.jpeg` y `analysis-story.jpeg` se usan únicamente en los pasos “Venta”, “Inventario” y “Análisis” del recorrido de la landing. Los assets PNG permanecen como las capturas de las demás secciones.

La captura de Caja se usa de forma estática en el hero. La única experiencia operable está en “Kova en acción”, usa estado y activos locales y muestra explícitamente `Demo interactiva · No registra ventas`.

Para regenerar las imágenes, desde `frontend/` define `KOVA_CAPTURE_EMAIL` y `KOVA_CAPTURE_PASSWORD` sólo como variables de entorno y ejecuta `npm run capture:showcase`. `KOVA_CAPTURE_BASE_URL` apunta a `http://localhost:5173` por defecto. Para una auditoría productiva de sólo lectura también se requiere `KOVA_CAPTURE_ALLOW_PRODUCTION=1`.

El script:

- conserva el AppShell completo y oculta el área de cuenta;
- prepara localmente, sin cobrar, Cold brew + Capuchino mediano + Yogurt con granola = $186;
- bloquea cualquier request de escritura después del inicio de sesión;
- espera encabezados, fuentes e imágenes antes de capturar;
- rechaza correos visibles y valida que cada vista mida exactamente 1440×900;
- extrae a `products/` las fotografías usadas por la demo local.

Antes de publicar, revisar visualmente las cuatro capturas. No deben contener correos, nombres de personas, identificadores privados ni datos de clientes. Nunca pulsar `Cobrar`, `Cerrar turno`, `Ajustar`, `Aplicar` ni ninguna acción de escritura durante la captura.
