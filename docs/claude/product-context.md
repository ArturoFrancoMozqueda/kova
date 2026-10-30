# Contexto de producto de Kova

Kova es un SaaS de punto de venta y analítica para PyMEs mexicanas. Este documento recoge la
intención del producto y las decisiones del dueño que el código no explica por sí solo. La
disponibilidad real de cada función y los gates abiertos están en
[`../current-sprint.md`](../current-sprint.md); el comportamiento por dominio, en [`../../specs/`](../../specs/).

## Qué debe lograr

Que el dueño del negocio pueda:

- Vender con orden y rapidez.
- Controlar productos, inventario y empleados.
- Entender el desempeño con analítica real: qué se vende, cuándo y de dónde viene el dinero.
- Sentir que la suscripción vale lo que cuesta.

Kova es más que un POS: combina punto de venta, control de inventario, configuración de productos y
empleados, reportes y claridad operativa. No es una caja registradora genérica, un panel de
demostración ni un producto de "IA" sin valor concreto.

## Usuario principal

Dueño o gerente de una PyME en México, probablemente no técnico. Necesita flujos claros, datos en
los que pueda confiar y un producto que se vea profesional.

## Barra de calidad

Premium, confiable, claro, humano, rápido y simple sin sentirse básico.

El dueño exige un producto terminado en todas las pantallas: sin UUID de base de datos, versiones
técnicas, excepciones crudas ni etiquetas de implementación en pantallas de cliente o comercio.
Prefiere contexto de negocio y enlaces al registro exacto. Se conservan los folios, SKU, RFC e
identificadores fiscales útiles, y los estados de facturación, conexión y pago deben ser honestos.
El diagnóstico va en el contexto protegido de soporte y operación.

## Voz y copy

Español de México por defecto. Seguro pero sin exagerar, y comprensible para cualquier dueño. Evita
clichés, promesas infladas y relleno corporativo.

## Dirección: automatización de punta a punta

El dueño pidió evolucionar hacia automatizar el negocio completo: captación, conversaciones con
clientes, pedidos confirmados, pagos verificados, entrega, reposición y recompra, conectado a ventas,
inventario y costos reales, con permisos explícitos y resultados medibles.

Es dirección, no una afirmación de disponibilidad: los canales conectados (por ejemplo WhatsApp) y los
proveedores externos no se presentan como activos salvo que `current-sprint.md` y el código lo
confirmen. Registrar que algo se compartió no lo envía; cerrar una atención no devuelve dinero ni
contacta al cliente.

## Decisiones del dueño sobre lealtad

- Las tarjetas de puntos son digitales y basadas en el dispositivo desde el menú publicado. Wallet y
  proveedores de pases de pago quedan fuera.
- La inscripción es opt-in del dueño, crea un cliente nuevo con alias y usa una cookie HttpOnly
  separada. El código de socio o QR identifica al cliente solo dentro del POS autenticado y nunca
  autentica una consulta pública de saldo.
- La tarjeta muestra primero el QR; el número es una alternativa manual explícita.
- Las recompensas del POS son definidas por el dueño, se aplican de forma atómica al cobrar y se
  restauran al reembolsar. Los snapshots financieros históricos no cambian.
- La recuperación entre dispositivos con contacto verificado queda como trabajo futuro.

Especificaciones: [`../../specs/loyalty/`](../../specs/loyalty/).
