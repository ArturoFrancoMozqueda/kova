Feature: Open a shift

  Scenario: Cashier opens a shift with opening cash
    Given an authenticated cashier with no open shift
    When the cashier opens a shift with opening cash "500.00"
    Then the shift is created successfully
    And the shift status is "open"
    And an opening balance cash movement is recorded
    And the shift appears in the audit log

  Scenario: Cashier opens a shift without opening cash
    Given an authenticated cashier with no open shift
    When the cashier opens a shift without opening cash
    Then the shift is created successfully
    And the shift status is "open"
    And no opening balance movement is recorded

  Scenario: Cannot open a shift if one is already open
    Given an authenticated cashier with an open shift
    When the cashier attempts to open another shift
    Then a 400 error is returned

  Scenario: Duplicate open request with same key returns same response
    Given an authenticated cashier with no open shift
    When the cashier opens a shift with idempotency key "shift-001"
    And opens a shift again with key "shift-001"
    Then both requests return the same shift response
    And only one shift exists

  Scenario: Permission denied without shifts.open permission
    Given an authenticated user without shift open permission
    When the user attempts to open a shift
    Then a 403 error is returned

  Scenario: Tenant isolation: cannot see another tenant's open shift
    Given two separate tenants with open shifts
    When tenant B queries the current shift
    Then only tenant B's shift is returned
