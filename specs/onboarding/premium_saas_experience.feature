Feature: Premium SaaS POS experience
  The product should clearly sell one POS subscription, guide new tenants into setup,
  and show only business analytics backed by real backend data.

  Scenario: Visitor understands the product from the landing page
    Given a visitor has not signed in
    When they open the public root page
    Then the app should explain that the POS helps small food retail businesses sell, manage products, track inventory, and review sales
    And the app should provide clear calls to sign up or log in

  Scenario: Visitor sees one simple subscription plan
    Given a visitor is comparing pricing
    When they reach the pricing section
    Then the app should show one Standard Plan at $299 MXN/month
    And the app should not show multiple pricing tiers

  Scenario: User registers
    Given a visitor wants to start using the POS
    When they create a tenant account and verify their email
    Then the app should confirm the account is ready for login

  Scenario: User pays
    Given an owner has an account without an active subscription
    When they start checkout from billing
    Then the app should send them to Stripe Checkout for the Standard Plan
    And the app should return them to billing after success or cancellation

  Scenario: User enters onboarding
    Given an owner signs in for the first time
    When the dashboard loads real setup state
    Then the app should show the next setup actions based on missing catalog, inventory, subscription, or sales activity

  Scenario: User uploads logo is unavailable until backend support exists
    Given the backend does not expose tenant logo settings
    When the owner reviews POS customization
    Then the app should not present a fake logo upload completion flow
    And the required backend data should be documented as a future dependency

  Scenario: User creates products
    Given an owner has permission to manage catalog
    When they create a product
    Then the app should add the product to the tenant catalog
    And the setup checklist should treat catalog setup as complete based on real product data

  Scenario: User adds employees is unavailable until backend support exists
    Given the backend does not expose employee invitation or management endpoints
    When the owner reviews POS customization
    Then the app should not present a fake employee management completion flow
    And the required membership management API should be documented as a future dependency

  Scenario: User manages inventory
    Given a product tracks inventory
    When the owner records a stock take, adjustment, or threshold
    Then the app should update inventory using the real inventory API
    And low-stock alerts should reflect real inventory state

  Scenario: User views analytics based on real data
    Given the tenant has completed sales
    When the owner opens dashboard or reports
    Then the app should calculate sales, transactions, average ticket, payment mix, refunds, voids, and top products from report APIs

  Scenario: User sees empty states when real data is missing
    Given the tenant has no completed sales in the selected period
    When the owner opens reports
    Then the app should show empty states for payment mix and top products
    And the app should not render fake charts, demo numbers, or sample analytics data

  Scenario: User uses the app on mobile
    Given the user opens the landing page or dashboard on a mobile browser
    When the content is displayed
    Then the app should stack sections clearly
    And primary actions should remain visible and tappable
