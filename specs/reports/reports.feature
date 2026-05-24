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

  Scenario: Manager views hourly sales trend
    Given an authenticated manager with sales in different hours
    When the manager requests the hourly sales report
    Then sales are grouped into 24 hourly buckets

  Scenario: Manager views employee sales performance
    Given an authenticated manager with sales from multiple employees
    When the manager requests the employee sales report
    Then sales are grouped by employee with refund counts

  Scenario: Manager views refund reasons
    Given an authenticated manager with refunds for different reasons
    When the manager requests the refund reason report
    Then refunds are grouped by reason

  Scenario: Manager views the business story report
    Given an authenticated manager with sales across days, dayparts, products, payments, and corrections
    When the manager requests the business story report
    Then daily sales, daypart sales, peak hour, product share, payment share, and recommended actions are calculated from real data

  Scenario: Owner sees a compact decision brief
    Given an authenticated owner with current sales, previous-period sales, and a low-stock top product
    When the owner opens the reports page
    Then the report shows previous-period comparison and restock guidance
    And the decision brief shows no more than three recommended actions
    And detailed KPI and chart sections are collapsed until the owner opens detailed analysis
    And the detailed analysis prioritizes timing, product inventory, payment operations, and meaningful employee comparison

  Scenario: Owner sees consistent strongest time block
    Given an authenticated owner with afternoon sales higher than morning sales
    When the owner opens the reports page
    Then the executive summary, decision brief, and timing detail all show afternoon as the strongest block
    And the peak hour shown belongs to the afternoon block

  Scenario: Owner views today's report after Mexico City business close
    Given an authenticated owner in the America/Mexico_City timezone
    And UTC has advanced to the next calendar day while Mexico City is still on the prior business date
    When the owner applies the Today preset on the reports page
    Then the report requests the Mexico City business date, not the UTC date

  Scenario: Manager views an empty business story report
    Given an authenticated manager without completed sales
    When the manager requests the business story report
    Then the report returns empty-state guidance without demo insights

  Scenario: Permission denied without reports view permission
    Given an authenticated cashier without reports permission
    When the cashier requests the sales summary report
    Then a 403 error is returned

  Scenario: Tenant isolation: cannot see another tenant's reports
    Given tenant A has completed sales
    When tenant B requests the sales summary report
    Then tenant A's sales are not included
