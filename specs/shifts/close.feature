Feature: Close a shift with reconciliation

  Scenario: Cashier closes a shift with balanced cash
    Given an authenticated cashier with an open shift and sales
    When the cashier closes the shift with actual cash "1050.00"
    Then the shift is closed successfully
    And the reconciliation status is "balanced"
    And the variance amount is "0.00"
    And the shift appears in the audit log

  Scenario: Cashier closes a shift with overage
    Given an authenticated cashier with an open shift and sales
    When the cashier closes the shift with actual cash "1100.00"
    Then the shift is closed successfully
    And the reconciliation status is "overage"
    And the variance amount is "50.00"

  Scenario: Cashier closes a shift with shortage
    Given an authenticated cashier with an open shift and sales
    When the cashier closes the shift with actual cash "1000.00"
    Then the shift is closed successfully
    And the reconciliation status is "shortage"
    And the variance amount is "-50.00"

  Scenario: Cannot close a shift that is already closed
    Given an authenticated cashier with a closed shift
    When the cashier attempts to close the shift again
    Then a 400 error is returned

  Scenario: Duplicate close request with same key returns same response
    Given an authenticated cashier with an open shift
    When the cashier closes the shift with idempotency key "close-001"
    And closes the shift again with key "close-001"
    Then both requests return the same close response
    And the shift is only closed once

  Scenario: Permission denied without shifts.close permission
    Given an authenticated cashier without close permission
    When the cashier attempts to close a shift
    Then a 403 error is returned

  Scenario: Tenant isolation: cannot close another tenant's shift
    Given two separate tenants with open shifts
    When tenant B attempts to close tenant A's shift
    Then a 404 error is returned
