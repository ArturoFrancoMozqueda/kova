Feature: Inventory basics

  Scenario: Manager manually adjusts stock
    Given an authenticated manager with a tracked product
    When the manager adjusts stock by 12 with reason "opening_count"
    Then the product stock on hand is 12
    And the adjustment appears in the audit log

  Scenario: Manager performs a stock take
    Given an authenticated manager with stock on hand of 12
    When the manager records a stock take count of 5 with reason "physical_count"
    Then the product stock on hand is 5
    And the stock take delta is -7

  Scenario: Low stock threshold flags product
    Given an authenticated manager with stock on hand of 3
    When the manager sets the low stock threshold to 5
    Then the product appears in the low stock list

  Scenario: Permission denied without inventory adjust permission
    Given an authenticated cashier without inventory adjust permission
    When the cashier attempts to adjust stock
    Then a 403 error is returned

  Scenario: Tenant isolation: cannot see another tenant's stock
    Given tenant A has a tracked product with stock
    When tenant B views the inventory stock list
    Then tenant A's product is not returned
