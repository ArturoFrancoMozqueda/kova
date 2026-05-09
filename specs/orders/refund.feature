Feature: Refund items from a completed order

  Scenario: Manager refunds one item from an order
    Given an authenticated manager with a completed order
    When the manager refunds one item with reason "customer_return"
    Then the refund is created successfully
    And the refunded inventory is restored
    And the refund appears in the audit log

  Scenario: Manager refunds multiple items from an order
    Given an authenticated manager with a completed order
    When the manager refunds multiple items with reason "defective"
    Then the refund amount is calculated correctly
    And the refunded inventory is restored for all items

  Scenario: Cannot refund more than available quantity
    Given an authenticated manager with a completed order
    When the manager attempts to refund more items than ordered
    Then a 400 error is returned
    And no refund is created

  Scenario: Cannot refund a voided order
    Given an authenticated manager with a voided order
    When the manager attempts to refund an item
    Then a 400 error is returned

  Scenario: Duplicate refund request with same key returns same response
    Given an authenticated manager with a completed order
    When the manager creates a refund with idempotency key "refund-001"
    And creates the same refund again with key "refund-001"
    Then both requests return the same refund response
    And only one refund exists in the database

  Scenario: Permission denied for refund without orders.refund permission
    Given an authenticated cashier without refund permission
    When the cashier attempts to refund an item
    Then a 403 error is returned

  Scenario: Tenant isolation: cannot refund another tenant's order
    Given two separate tenants with orders
    When tenant B attempts to refund tenant A's order
    Then a 404 error is returned
