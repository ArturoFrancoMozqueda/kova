# Showcase de marketing fiel al producto

La landing separa con claridad evidencia y experimentación:

- **Hero:** `register.png`, una captura estática, actual y sanitizada de la Caja productiva.
- **Demo interactiva:** una única Caja React con estado exclusivamente local. Reproduce una venta de $186 y nunca consume APIs autenticadas ni registra ventas.
- **Vistas reales:** Inventario, Turnos y Reportes son capturas completas del producto, con el AppShell real y la etiqueta `Vista real del producto`.
- **Orquestación:** `KovaShowcase` mantiene autoavance, controles manuales, pausa por interacción/viewport y movimiento reducido. El cursor sólo aparece durante la reproducción automática de la demo.

La historia larga `SaleStory` no se monta en Home. El recorrido compacto conserva venta → inventario → turno → reporte → CTA.

## Regenerar capturas

Desde `frontend/`:

```powershell
$env:KOVA_CAPTURE_EMAIL="<usuario>"
$env:KOVA_CAPTURE_PASSWORD="<contraseña>"
$env:KOVA_CAPTURE_BASE_URL="https://kovasuite.com"
$env:KOVA_CAPTURE_ALLOW_PRODUCTION="1"
npm run capture:showcase
```

Las credenciales viven sólo en el entorno local. No se escriben en código, documentación, capturas ni logs. El modo producción debe utilizarse únicamente con un tenant autorizado y en lectura.

El script abre Caja, prepara localmente Cold brew ($62), Capuchino mediano ($56) y Yogurt con granola ($68), verifica el total de $186 y captura sin pulsar `Cobrar`. Después visita Inventario, Turnos y Reportes. Cualquier request de escritura posterior al login se bloquea; las imágenes finales se validan a 1440×900 y se rechazan si queda un correo visible.

## Verificación

- El hero no contiene controles interactivos ni una segunda demo.
- La demo responde localmente sin requests ni creación de ventas.
- Los controles permanecen deshabilitados hasta terminar la hidratación.
- Una selección manual cancela inmediatamente el temporizador y detiene el autoavance.
- Hover, foco y salida del viewport pausan el recorrido.
- `prefers-reduced-motion` conserva navegación manual y elimina cursor/autoavance.
- Las capturas usan `object-fit: contain`; no recortan encabezados, gráficos ni tablas.
- En móvil no existe overflow horizontal y la Caja responde al ancho del contenedor.
