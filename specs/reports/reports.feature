Feature: Sales reports

  Scenario: Manager views a sales range summary
    Given an authenticated manager with completed sales and a refund
    When the manager requests the sales summary report
    Then gross sales, refunds, and net sales are calculated correctly

  Scenario: Manager views payment method totals
    Given an authenticated manager with split payment sales
    When the manager requests the payment breakdown report
    Then payment totals are grouped by method

  Scenario: Manager views top products
    Given an authenticated manager with completed sales
    When the manager requests the top products report
    Then products are sorted by quantity sold

  Scenario: Permission denied without reports view permission
    Given an authenticated cashier without reports permission
    When the cashier requests the sales summary report
    Then a 403 error is returned

  Scenario: Tenant isolation: cannot see another tenant's reports
    Given tenant A has completed sales
    When tenant B requests the sales summary report
    Then tenant A's sales are not included
