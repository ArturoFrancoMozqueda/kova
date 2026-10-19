# language: es
Característica: Seguimiento comercial y autorización explícita por canal
  Las oportunidades no generan ingresos y los contactos no autorizan mensajes por sí solos.

  Escenario: Oportunidad ganada sin ingreso ficticio
    Dado un dueño con acceso comercial y un cliente de su negocio
    Cuando registra y marca como ganada una oportunidad
    Entonces conserva el importe estimado y el historial comercial
    Y no se crea una venta ni un pago

  Escenario: Retirar autorización y repetir la solicitud
    Dado un consentimiento vigente para WhatsApp transaccional
    Cuando el dueño lo retira con la versión actual
    Y repite la solicitud con la misma clave de idempotencia
    Entonces existe una sola retirada y el contacto ya no está autorizado

  Escenario: Dirección distinta requiere nueva autorización
    Dado un cliente con autorización explícita para su teléfono actual
    Cuando el teléfono registrado cambia
    Entonces la autorización no se transfiere al nuevo teléfono
    Y Kova indica que requiere reconfirmación

  Escenario: Conflicto de edición
    Dado una oportunidad editada después de abrir el formulario
    Cuando otro guardado usa la versión anterior
    Entonces se rechaza sin sobrescribir los datos vigentes

  Escenario: Aislamiento comercial
    Dado dos negocios y varias sucursales
    Cuando un operador consulta o cambia una oportunidad ajena a su contexto
    Entonces no obtiene ni modifica el registro
