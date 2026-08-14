Feature: Productos con variantes independientes
  Scenario: Producto simple compatible
    Given un producto existente sin variantes
    When el cajero lo agrega a la venta
    Then el flujo no requiere seleccionar una variante

  Scenario: Escaneo resuelve una variante
    Given dos variantes activas con SKU únicos
    When el cajero escanea el SKU de una variante
    Then se agrega esa variante con su precio y snapshot

  Scenario: Selección obligatoria
    Given un producto con talla chica y grande
    When el cajero selecciona el producto padre
    Then debe elegir una talla antes de agregarlo

  Scenario: Inventario independiente
    When se vende una unidad de la variante grande
    Then sólo disminuye el inventario de la variante grande

  Scenario: Catálogo inválido atómico
    When un manager intenta guardar combinaciones o SKU duplicados
    Then ninguna variante del payload se persiste

  Scenario: Replay offline
    Given una venta offline de una variante con client_uuid
    When la venta se sincroniza dos veces
    Then una sola orden afecta una vez esa variante

  Scenario: Aislamiento de tenant
    When una venta referencia una variante de otro tenant
    Then el servidor responde recurso no encontrado
