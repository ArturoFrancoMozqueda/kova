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

  @p0 @offline @orders @idempotency @browser @integration
  Scenario Outline: A prepared register resumes after an offline reload and a lost sync response
    Given a prepared register with an open shift at <width> pixels
    When the browser loses its connection and saves a cash sale
    Then the queued sale has not consumed synchronization attempts
    When the register reloads without a connection
    Then the same queued sale remains on the device
    When the browser reconnects and loses the first successful sync response
    Then the server revalidates the session before synchronization
    And retrying creates one sale, one payment and one inventory debit
    And the catalog and shift refresh so the next cash sale can proceed

    Examples:
      | width |
      | 390   |
      | 1440  |
