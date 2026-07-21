# Marketing showcase híbrido

La landing usa una demostración híbrida para mantener fidelidad sin llevar datos demo al producto:

- **Caja:** React interactivo con estado local de Sweet Home. Sus tarjetas de producto y métodos de pago vienen de `register/RegisterPresentation.tsx`, el mismo módulo presentacional consumido por `RegisterView`.
- **Inventario, Turnos y Reportes:** capturas reales y sanitizadas en `frontend/public/showcase/`.
- **Orquestación:** `KovaShowcase` mantiene el cursor guiado, autoavance, controles manuales y modo de movimiento reducido.

La historia larga `SaleStory` ya no se monta en Home. Los cuatro efectos de la venta de $186 viven en un solo recorrido.

## Regenerar capturas

Usa un tenant local sembrado. Desde `frontend/`:

```powershell
$env:KOVA_CAPTURE_EMAIL="<usuario-local>"
$env:KOVA_CAPTURE_PASSWORD="<contraseña-local>"
$env:KOVA_CAPTURE_BASE_URL="http://localhost:5173" # opcional
npm run capture:showcase
```

El script:

- recibe credenciales sólo por variables de entorno y no las imprime;
- colapsa el sidebar y captura únicamente el contenido principal;
- usa viewport determinista de 1440×900 y movimiento reducido;
- rechaza cualquier correo visible en el área capturable;
- bloquea producción salvo `KOVA_CAPTURE_ALLOW_PRODUCTION=1`.

Antes de publicar, revisar los tres PNG visualmente. No deben contener correos, nombres privados, identificadores de cuenta ni datos reales de clientes.

## Verificación

- Caja responde localmente sin requests ni creación de ventas.
- Los pasos manuales detienen el autoavance.
- Hover, foco y salida de viewport pausan el recorrido.
- `prefers-reduced-motion` conserva navegación manual y elimina cursor/autoavance.
- En móvil no aparece cursor y la Caja conserva catálogo y carrito legibles.
