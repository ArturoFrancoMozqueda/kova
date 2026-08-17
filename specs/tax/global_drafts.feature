Feature: Borradores internos por periodo
  Los owners agrupan ventas elegibles sin emitir ni representar un CFDI.

  @p0 @fiscal @tenant-isolation
  Scenario: Otro tenant no puede consultar un borrador
    Given un borrador interno cerrado por el tenant A
    When el tenant B intenta consultar el borrador por id
    Then recibe 404
    And no recibe importes ni ventas del tenant A

  @p0 @fiscal @rbac
  Scenario: Cajero no puede cerrar un borrador
    Given un cajero de un tenant con borradores internos habilitados
    When intenta cerrar el periodo actual
    Then recibe 403
    And no se crea ningún borrador

  @p0 @fiscal @idempotency
  Scenario: Repetir el cierre no duplica el borrador
    Given ventas elegibles en un periodo fiscal concluido
    When el owner cierra dos veces con la misma clave y el mismo cuerpo
    Then ambas respuestas identifican el mismo borrador
    And cada venta pertenece una sola vez al borrador

  @p0 @fiscal @idempotency
  Scenario: Una clave no puede cerrar un periodo distinto
    Given un cierre exitoso con una clave idempotente
    When el owner reutiliza la clave para otro periodo
    Then recibe un conflicto
    And el borrador original no cambia

  @p0 @fiscal @concurrency
  Scenario: Periodos solapados no duplican ventas
    Given un borrador interno cerrado para un periodo
    When el owner intenta cerrar un periodo que se solapa
    Then recibe un conflicto
    And ninguna venta cambia de borrador

  @p1 @fiscal @calendar
  Scenario: Una venta de medianoche pertenece a un solo día local
    Given ventas alrededor de medianoche en America/Mexico_City
    When el owner previsualiza dos días contiguos
    Then la venta del límite aparece sólo en el segundo día

  @p1 @fiscal @calendar
  Scenario: Febrero bisiesto conserva el día veintinueve
    Given ventas del 29 de febrero de 2024 en America/Mexico_City
    When el owner previsualiza febrero de 2024
    Then las ventas del día veintinueve están incluidas
    And ninguna venta de marzo está incluida

  @p0 @fiscal @eligibility
  Scenario: Venta marcada para atención individual se excluye
    Given una venta completada marcada para atención individual
    When el owner previsualiza el periodo de esa venta
    Then la venta no es elegible para el borrador interno
    And la previsualización cuenta la exclusión

  @p0 @fiscal @refunds
  Scenario: Una devolución no reescribe el snapshot original
    Given una venta con snapshot y una devolución posterior
    When el owner cierra el periodo correspondiente
    Then el ajuste se calcula desde el snapshot original
    And la venta histórica conserva sus valores originales

  @p0 @fiscal @voids
  Scenario: Una venta anulada no se presenta como vigente
    Given una venta anulada antes de cerrar el periodo
    When el owner previsualiza el periodo
    Then la venta anulada no suma como venta vigente

  @p0 @fiscal @transaction
  Scenario: Una falla no deja asignaciones parciales
    Given varias ventas elegibles para un cierre
    When falla la persistencia antes de confirmar el borrador
    Then no existe el borrador
    And ninguna venta queda asignada

  @p0 @fiscal @copy
  Scenario: La interfaz describe evidencia interna
    Given un borrador cerrado sin integración fiscal externa
    When el owner consulta su detalle
    Then la vista lo identifica como borrador interno
    And aclara que las ventas conservan recibos operativos
    And muestra el estado humano Borrador interno · No es CFDI
    And sólo ofrece un CSV de control interno y la impresión del navegador

  @p0 @fiscal @scheduler @idempotency
  Scenario: El scheduler recupera un periodo omitido una sola vez
    Given un tenant habilitado con un periodo vencido sin borrador
    When el scheduler interno ejecuta el catch-up dos veces
    Then existe un solo borrador para el periodo vencido
    And cada venta pertenece una sola vez al borrador

  @p0 @fiscal @scheduler @security
  Scenario: Una llamada interna no autorizada no ejecuta cierres
    Given tenants con periodos vencidos
    When se invoca el scheduler con una credencial interna inválida
    Then la solicitud es rechazada
    And no se crea ningún borrador

  @p1 @fiscal @scheduler @recovery
  Scenario: Un tenant fallido no duplica los demás cierres
    Given varios tenants con periodos vencidos y uno falla al persistir
    When el scheduler ejecuta el catch-up y después reintenta
    Then los tenants exitosos conservan un solo borrador por periodo
    And el tenant fallido puede recuperarse sin asignaciones parciales

  @p1 @fiscal @scheduler @feature-gate
  Scenario: Auto-preparación respeta configuración y feature flag
    Given tenants sin flag o con auto-preparación deshabilitada
    When el scheduler interno busca periodos vencidos
    Then esos tenants se omiten
    And ningún cierre manual existente cambia

  @p1 @fiscal @calendar
  Scenario: Día treinta y uno usa el final de un mes corto
    Given preparación mensual configurada para el día 31
    When Kova calcula el periodo de febrero
    Then el cierre usa el último día real de febrero
    And no incluye una venta del primer día de marzo

  @p0 @fiscal @configuration
  Scenario: Los valores iniciales no simulan una preparación guardada
    Given un tenant sin preparación fiscal persistida
    When owner y manager abren Borradores por periodo
    Then la API indica que la preparación no está configurada sin crear una fila
    And el owner debe guardar la propuesta inicial antes de previsualizar
    And el manager ve que sólo el propietario puede confirmarla

  @p0 @fiscal @configuration @client-trust
  Scenario: Cambiar la preparación invalida una vista previa anterior
    Given una vista previa preparada con configuración persistida
    When el owner cambia la periodicidad o el día de cierre sin guardar
    Then la vista previa anterior desaparece
    And previsualizar y cerrar quedan bloqueados hasta guardar

  @p0 @fiscal @calendar @regression
  Scenario: La fecha visible nunca cambia el contrato ISO
    Given preparación mensual guardada para el día 31 y hoy es 16 de agosto de 2026
    When el navegador usa es-MX o en-US
    Then Kova propone el último cierre concluido 2026-07-31
    And solicita la vista previa con period_end igual a 2026-07-31
    And rechaza 2026-07-16 en línea sin solicitar una vista previa

  @p1 @fiscal @calendar
  Scenario Outline: Día semanal sigue numeración ISO
    Given preparación semanal configurada con el valor <numero>
    When Kova calcula el fin de semana
    Then el día de cierre es <dia>

    Examples:
      | numero | dia       |
      | 1      | lunes     |
      | 2      | martes    |
      | 3      | miércoles |
      | 4      | jueves    |
      | 5      | viernes   |
      | 6      | sábado    |
      | 7      | domingo   |

  @p0 @fiscal @immutability
  Scenario: Un batch cerrado rechaza edición directa
    Given un borrador interno cerrado
    When el rol de aplicación intenta actualizar o borrar sus snapshots
    Then la base de datos rechaza la mutación
    And la ecuación monetaria histórica permanece reconciliada

  @p0 @fiscal @client-trust
  Scenario: El cliente no puede confirmar atención individual
    Given una venta nueva sin atención individual confirmada por el servidor
    When el cliente agrega un estado individual al payload de venta
    Then el servidor no confirma ese estado
    And la venta conserva el contrato compatible de sincronización

  @p0 @fiscal @accountant-export @tenant-isolation
  Scenario: Otro tenant no puede descargar el reporte para contador
    Given un borrador interno cerrado por el tenant A
    When el owner del tenant B solicita su reporte CSV por id
    Then recibe 404
    And no recibe filas, importes ni metadatos del tenant A

  @p0 @fiscal @accountant-export @rbac
  Scenario Outline: Sólo roles de consulta fiscal descargan el reporte
    Given un borrador interno cerrado y el rol <rol>
    When solicita el reporte CSV para contador
    Then el resultado es <resultado>

    Examples:
      | rol     | resultado |
      | owner   | permitido |
      | manager | permitido |
      | cashier | 403       |
      | staff   | 403       |

  @p0 @fiscal @accountant-export @csv-security
  Scenario: Valores con fórmulas se neutralizan en CSV
    Given un nombre de negocio que inicia con igual, más, menos o arroba
    When el owner descarga el reporte CSV
    Then cada valor riesgoso se exporta como texto literal neutralizado
    And ninguna celda ejecuta una fórmula al abrirse en una hoja de cálculo

  @p0 @fiscal @accountant-export @privacy
  Scenario: El reporte usa datos mínimos de control interno
    Given un borrador con ventas que contienen datos de cliente
    When un manager descarga el reporte CSV
    Then el archivo no incluye nombre, correo, teléfono, domicilio ni dato fiscal del cliente
    And sólo contiene identificadores operativos, periodos e importes congelados necesarios

  @p1 @fiscal @accountant-export @format
  Scenario: El CSV conserva formato interoperable y no se almacena en caché
    Given un borrador con acentos, comas, comillas y saltos de línea
    When el owner descarga el reporte CSV
    Then la respuesta es UTF-8 con encabezados estables y escape RFC 4180
    And Content-Disposition propone un nombre seguro terminado en csv
    And Cache-Control es no-store

  @p1 @fiscal @accountant-export @empty
  Scenario: Un reporte sin filas elegibles conserva su encabezado
    Given un borrador histórico válido sin ventas exportables
    When el owner descarga el reporte CSV
    Then el archivo contiene encabezados y cero filas de venta
    And no inventa clientes, impuestos ni importes

  @p0 @fiscal @accountant-export @copy
  Scenario: El reporte para contador no se presenta como comprobante fiscal
    Given un borrador interno cerrado sin integración fiscal externa
    When owner o manager abre el reporte compacto
    Then ve reporte de control interno, recibo operativo y no emitido
    And ve Borrador interno · No es CFDI y que Kova no calcula impuestos hoy
    And la opción PDF sólo invoca la impresión del navegador sin persistir un archivo
