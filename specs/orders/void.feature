Feature: Void a completed order

  Scenario: Manager voids a completed order
    Given an authenticated manager with a completed order
    When the manager voids the order with reason "operator_error"
    Then the void is created successfully
    And the order status is marked as "voided"
    And all inventory is reversed
    And the void appears in the audit log

  Scenario: Cannot void an order that is already voided
    Given an authenticated manager with a voided order
    When the manager attempts to void the order again
    Then a 400 error is returned

  Scenario: Cannot void an order with existing refunds
    Given an authenticated manager with a refunded order
    When the manager attempts to void the order
    Then a 400 error is returned

  Scenario: Duplicate void request with same key returns same response
    Given an authenticated manager with a completed order
    When the manager voids the order with idempotency key "void-001"
    And voids the same order again with key "void-001"
    Then both requests return the same void response
    And only one void exists in the database

  Scenario: Permission denied for void without orders.void permission
    Given an authenticated cashier without void permission
    When the cashier attempts to void an order
    Then a 403 error is returned

  Scenario: Tenant isolation: cannot void another tenant's order
    Given two separate tenants with orders
    When tenant B attempts to void tenant A's order
    Then a 404 error is returned
