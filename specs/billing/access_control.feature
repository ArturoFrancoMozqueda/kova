Feature: Billing access control
  Paid POS writes require a trial, active subscription, or active grace period.

  Scenario: Tenant in signup trial can create a sale
    Given an authenticated tenant is inside the signup trial
    And the tenant has a sellable product
    When the cashier creates a cash sale
    Then the sale is created successfully

  Scenario: Tenant after trial expiry is blocked from creating a sale
    Given an authenticated tenant has no subscription and the signup trial has expired
    And the tenant has a sellable product
    When the cashier creates a cash sale
    Then payment is required
    And the billing block is recorded in the audit log

  Scenario: Tenant with an active subscription can create a sale
    Given an authenticated tenant has an active subscription
    And the tenant has a sellable product
    When the cashier creates a cash sale
    Then the sale is created successfully

  Scenario: Blocked tenant can still start billing recovery
    Given an authenticated tenant has no subscription and the signup trial has expired
    When the owner starts checkout
    Then a Stripe checkout URL is returned
