Feature: Record cash movements during a shift

  Scenario: Manager records a cash removal
    Given an authenticated manager with an open shift
    When the manager records a cash removal of "100.00" with reason "bank deposit"
    Then the cash movement is recorded successfully
    And the movement type is "cash_out"
    And the movement appears in the audit log

  Scenario: Manager records a cash deposit
    Given an authenticated manager with an open shift
    When the manager records a cash deposit of "200.00" with reason "customer refund"
    Then the cash movement is recorded successfully
    And the movement type is "cash_in"

  Scenario: Cash movements affect shift reconciliation
    Given an authenticated manager with an open shift
    When the manager records a cash removal of "50.00"
    And closes the shift with actual cash matching expected
    Then the reconciliation is balanced

  Scenario: Cannot record negative amount
    Given an authenticated manager with an open shift
    When the manager attempts to record a movement with amount "-100.00"
    Then a 400 error is returned

  Scenario: Cannot record movement without open shift
    Given an authenticated manager with no open shift
    When the manager attempts to record a cash movement
    Then a 400 error is returned

  Scenario: Permission denied for non-managers
    Given an authenticated cashier without cash movement permission
    When the cashier attempts to record a cash movement
    Then a 403 error is returned

  Scenario: Tenant isolation: cannot record in another tenant's shift
    Given two separate tenants with open shifts
    When tenant B attempts to record a movement in tenant A's shift
    Then a 404 error is returned
