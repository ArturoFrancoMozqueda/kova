# Matriz de QA física para impresoras térmicas

Esta matriz valida el soporte de navegador de Kova para papel de 58 mm y 80 mm. No certifica SDK,
impresión silenciosa, corte automático ni apertura de cajón. El operador siempre confirma el
diálogo de impresión del navegador y debe elegir en el driver el mismo ancho configurado en Kova.

La integración opcional de apertura por conector ESC/POS de red se verifica por separado en
[`cash_drawer.md`](../specs/shifts/cash_drawer.md). Su implementación local no certifica los
modelos de esta matriz ni cambia el diálogo de impresión de tickets.

## Registro de dispositivos

| Ancho | Impresora / modelo | Conexión | SO | Navegador / versión | Driver | Resultado | Evidencia / notas |
|---|---|---|---|---|---|---|---|
| 58 mm | Pendiente | USB / red / Bluetooth | Pendiente | Chrome / Edge, pendiente | Pendiente | No verificado | Adjuntar foto del ticket y configuración del driver. |
| 80 mm | Pendiente | USB / red / Bluetooth | Pendiente | Chrome / Edge, pendiente | Pendiente | No verificado | Adjuntar foto del ticket y configuración del driver. |

## Casos obligatorios por dispositivo

| Caso | 58 mm | 80 mm | Criterio de aceptación |
|---|---|---|---|
| Venta simple en efectivo | Pendiente | Pendiente | Una sola columna, total completo, sin recorte lateral. |
| Venta con nombre y modificadores largos | Pendiente | Pendiente | Ajuste de línea legible; ningún importe sale del papel. |
| Pago dividido y cambio | Pendiente | Pendiente | Cada método, entregado y cambio se distinguen. |
| Logo + texto fiscal + pie | Pendiente | Pendiente | Logo reconocible en monocromo y texto sin solaparse. |
| Recibo local sin conexión | Pendiente | Pendiente | Muestra folio local y estado pendiente; se imprime antes del sync. |
| Reimpresión desde detalle | Pendiente | Pendiente | Coincide con la vista previa y no imprime chrome de la app. |
| Devolución / cancelación | Pendiente | Pendiente | Motivo e importes corregidos quedan visibles. |
| Corte de caja | Pendiente | Pendiente | Esperado, real, diferencia y estado caben completos. |
| Dos impresiones consecutivas | Pendiente | Pendiente | La segunda conserva ancho, origen y contenido correctos. |

## Procedimiento

1. En `Configuración → Recibo`, elegir el ancho físico y guardar.
2. Configurar el mismo ancho y escala 100 % en el driver y diálogo del navegador.
3. Ejecutar cada caso con datos reales de QA, nunca con ventas de producción.
4. Confirmar origen superior izquierdo, márgenes uniformes, contraste y corte de líneas.
5. Registrar modelo, versiones, resultado y evidencia. Una fila `Pendiente` no cuenta como soporte
   físicamente verificado.

## Regresión sin hardware

- Verificar que `.print-receipt-root` y `.print-corte-root` lleven `data-paper-width="58|80"`.
- En media `print`, confirmar página nombrada `receipt-58` o `receipt-80` y que sólo sea visible la
  plantilla correspondiente.
- Confirmar que un PUT de una PWA anterior, sin `paper_width_mm`, no cambie una preferencia 58 mm.
