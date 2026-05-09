Feature: Online sale
  Cashiers need to complete a simple online sale with a recorded payment.

  @p0 @orders @money @idempotency @audit
  Scenario: Cashier completes a cash sale
    Given an active catalog product named "Concha" priced at "18.50"
    And a verified cashier for online sales
    When the cashier creates a cash sale for 2 units with "40.00" tendered
    Then the sale is completed with total "37.00"
    And the cash change due is "3.00"

  @p0 @orders @payment
  Scenario: Cashier records a bank transfer sale
    Given an active catalog product named "Baguette" priced at "30.00"
    And a verified cashier for online sales
    When the cashier creates a bank transfer sale for 1 unit
    Then the sale is completed with total "30.00"

  @p0 @orders @tenant-isolation
  Scenario: Tenants cannot read each other's orders
    Given two tenants with completed online sales
    Then the second tenant cannot read the first tenant order
