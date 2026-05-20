Feature: Standard Plan billing

  Scenario: Tenant owner starts checkout for the Standard Plan
    Given an authenticated tenant owner with billing management permission
    When the owner starts Standard Plan checkout
    Then a Stripe Checkout URL is returned for the $299 MXN monthly plan

  Scenario: Tenant returns from successful checkout
    Given an authenticated tenant owner has completed Stripe Checkout
    When the owner opens billing settings
    Then the UI shows the current subscription confirmation state

  Scenario: Stripe webhook activates a subscription idempotently
    Given Stripe sends a verified checkout completion event for a tenant
    When the webhook is processed
    Then the tenant subscription is active

  Scenario: Duplicate Stripe webhook does not duplicate side effects
    Given a Stripe event has already been processed
    When Stripe delivers the same event again
    Then the webhook returns success without duplicating subscription updates or audit logs

  Scenario: Past due tenant sees recovery guidance
    Given Stripe has reported a failed subscription payment
    When a tenant user opens the app
    Then a past due billing banner is shown with recovery guidance

  Scenario: Tenant owner cancels subscription
    Given an authenticated tenant owner has an active subscription
    When the owner requests cancellation
    Then the subscription is marked to cancel according to Stripe Billing state

  Scenario: Non-owner cannot manage billing
    Given an authenticated cashier without billing management permission
    When the cashier tries to start checkout or cancel subscription
    Then a 403 error is returned

  Scenario: Tenant isolation for billing
    Given tenant A has an active subscription
    When tenant B requests billing status
    Then tenant A's subscription is not returned
