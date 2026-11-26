Feature: Refund items from a completed order

  Scenario: Manager refunds one item from an order
    Given an authenticated manager with a completed order
    When the manager refunds one item with reason "customer_return"
    Then the refund is created successfully
    And the refunded inventory is restored
    And the refund appears in the audit log

  Scenario: Cash refund affects active shift reconciliation
    Given an authenticated manager with an open shift and a completed cash order
    When the manager refunds one item in cash with reason "customer_return"
    Then the refund is created successfully
    And a refund payout cash movement is recorded
    And shift reconciliation subtracts the refund payout

  Scenario: Manager refunds multiple items from an order
    Given an authenticated manager with a completed order
    When the manager refunds multiple items with reason "defective"
    Then the refund amount is calculated correctly
    And the refunded inventory is restored for all items

  Scenario: Manager returns the money but keeps a damaged unit out of stock
    Given an authenticated manager with a completed order of a stocked product
    When the manager refunds one stocked unit without restocking it
    Then the refund is created successfully
    And the stocked unit stays out of inventory
    And the loss appears as a refund not restocked

  Scenario: Cannot refund more than available quantity
    Given an authenticated manager with a completed order
    When the manager attempts to refund more items than ordered
    Then a 422 error is returned
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

  # API/PostgreSQL regression coverage: test_refund_method_validation.py.
  # Existing single-method requests keep their original idempotency hashes.
  # A new request may instead name refund_payments, with one positive Decimal
  # amount per original method. Both representations together are invalid.
  # Allocations must sum to the selected items' server-calculated refund total,
  # never exceed the remaining amount collected in each method, and commit
  # atomically with one refund, one set of returned quantities and inventory.
  # A $50 item paid $30 cash + $20 transfer can be returned as $30 + $20:
  # the cash drawer records only a $30 payout, not the full $50.
  # Receipts, payment-mix reports and account exports retain this distribution.
  # Browser retry identity is durable per tenant/user/branch/order before POST;
  # closing, reopening, navigating or reloading never creates a new identity
  # while the previous outcome remains uncertain. Recovery replays the same
  # payload/key, including when the receipt already shows a completed refund.
