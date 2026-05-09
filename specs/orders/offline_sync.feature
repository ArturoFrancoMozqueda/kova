Feature: Offline sales sync
  Cashiers need queued offline sales to sync safely when connectivity returns.

  @p0 @offline @orders @idempotency
  Scenario: Queued offline sale syncs into an order
    Given an active catalog product for offline sync
    And a verified cashier with a queued offline cash sale
    When the cashier syncs offline sales
    Then the queued sale is synced with an order id

  @p0 @offline @orders @idempotency
  Scenario: Replaying an offline sale does not duplicate the order
    Given an active catalog product for offline sync
    And a verified cashier with a queued offline cash sale
    When the cashier syncs offline sales twice
    Then both sync attempts return the same order id

  @p0 @offline @dead-letter
  Scenario: Invalid queued sale becomes a dead letter
    Given a verified cashier with an invalid queued offline sale
    When the cashier syncs offline sales
    Then the queued sale fails with a recoverable error
