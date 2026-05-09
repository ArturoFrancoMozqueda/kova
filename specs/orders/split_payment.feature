Feature: Split payment
  A cashier can record an order paid with multiple payment methods.
  The sum of all payment amounts must equal the order total.

  @p0 @orders @money
  Scenario: Cashier completes a split cash and bank transfer payment
    Given a verified tenant owner with a product priced at "50.00"
    When the cashier creates an order with cash "30.00" tendered "30.00" and bank transfer "20.00"
    Then the order total is "50.00"
    And the cash payment shows change due "0.00"
    And the bank transfer payment shows change due "0.00"

  @p0 @orders @money
  Scenario: Payment sum mismatch is rejected
    Given a verified tenant owner with a product priced at "50.00"
    When the cashier creates an order with payments summing to "49.00"
    Then the order is rejected with payment mismatch error
