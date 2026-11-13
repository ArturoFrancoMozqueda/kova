# Configuración visual del programa de lealtad

Estado: implementación local; sin publicación.

## Problema y experiencia

El dueño necesita entender y configurar su tarjeta sin recorrer formularios desconectados.
Clientes y saldos preceden la configuración. Guía: Apariencia → Acumulación → Recompensa →
Revisión y acceso. Vista previa con borrador en vivo, sin saldo, identidad o QR ficticios.
Escritorio: tarjeta junto al formulario; móvil: tarjeta compacta arriba. Movimiento reducido,
contraste de texto de al menos 4.5:1 y controles/foco compartidos.

Apariencia: color hexadecimal y logo general del negocio opcional. El diseño inicial conserva
el fondo oscuro existente; si falta logo, orientar a Configuración. El texto alterna blanco/negro
según contraste. La tarjeta pública y la vista previa comparten representación visual.

La regla usa importes explícitos MXN y puntos enteros; sin valores monetarios sugeridos.
Recompensa opcional: nombre, puntos y descuento POS según su contrato vigente. Pausar una
recompensa conserva revisiones y canjes. Acceso desde menú depende también de menú publicado,
política activa y gates existentes; no activa mensajes externos. Solo dueño, plan con lealtad.

Cerrar conserva borrador hasta confirmar descarte. Guardar publica los cuatro bloques juntos;
un conflicto conserva el borrador y exige consultar/revisar configuración actual. Los cambios
no recalculan ventas anteriores ni alteran puntos o vigencia de tarjetas emitidas.

## Contratos y datos

GET/PUT `/api/v1/loyalty/program`: nombre comercial, `policy`, `reward`, `enrollment`, `appearance`.
PUT exige versiones de todos los bloques, versión observada de recompensa aun al omitirla,
Idempotency-Key y CSRF. Un solo bloqueo de lealtad y transacción; agrega las revisiones existentes,
actualiza apariencia y registra respuesta idempotente/auditoría sin commits parciales.
Los endpoints anteriores conservan contratos y comparten bloqueo/versiones. Se mantiene el gate
comercial `loyalty` en el nuevo PUT. El estado de un plan inferior conserva puntos/canjes previos.

Tabla `loyalty_appearances` por tenant/sucursal: color, uso de logo y versión; RLS forzado,
FK compuesta, permisos por columna, exportación/purga. Respuesta de tarjeta añade `appearance`
y `booking_path` opcionales; logo solo desde el endpoint de carga propio. Membresías pueden
continuar a reservas mediante autorización específica, nunca usando el QR como credencial.

## Aceptación

- Escribir valores actualiza vista previa sin guardar; no generar puntos o enlaces utilizables.
- Seleccionar una recompensa o continuar sin ella; validar importes y puntos antes de revisar.
- Un error/versión obsoleta no publica ninguna parte del programa. Reintentar no duplica revisiones.
- Cambiar color/logo afecta tarjetas actuales conservando saldo, ajustes pendientes y expiración.
- Gerente/cajero no configuran; plan inferior no evita el gate mediante la API nueva.
- Sin conexión no se publica. Carga, error y ausencia de programa permanecen distinguibles.

Validar componente, teclado, contraste, descarte de borrador, PostgreSQL/RLS, regresiones de ledger,
recompensas y membresías, y navegador sobre build a 390/1440 px.
