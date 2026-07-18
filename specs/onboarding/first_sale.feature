Feature: First sale onboarding
  After signup, a new tenant should reach first sale through a derived checklist on the dashboard,
  with each step linking to the action that completes it and completion derived from real backend
  data.

  Scenario: New tenant lands on a setup checklist after verifying email
    Given a new owner has signed up and verified their email
    When they log in for the first time
    Then the dashboard should show an onboarding checklist
    And the next setup action should be highlighted within 5 seconds

  Scenario: Business profile step links to business profile settings
    Given an owner has no business profile configured
    When they open the checklist
    Then the business profile step should be uncompleted
    And selecting the step should navigate to the business profile settings form

  Scenario: Receipt settings step links to receipt settings
    Given an owner has no receipt settings configured
    When they open the checklist
    Then the receipt settings step should be uncompleted
    And selecting the step should navigate to the receipt settings form

  Scenario: Creating a product completes the catalog step
    Given an owner has no products
    When they create their first active product
    Then the checklist should mark catalog setup as completed on next load
    And the dashboard should show a first-product success state with the inventory action

  Scenario: Cafe preset is explicit and tenant scoped
    Given an owner has an empty catalog
    When they choose the cafeteria preset from catalog setup
    Then cafe products are created only for that tenant
    And no preset data appears before the owner chooses it

  Scenario: Grocery preset starts inventory without inventing margin
    Given an owner has an empty catalog
    When they choose the abarrotes preset from catalog setup
    Then grocery products with inventory are created only for that tenant
    And every preset product remains without a cost until the owner captures the real cost

  Scenario: Activating inventory completes the optional inventory step
    Given an owner has at least one product
    When they follow the checklist action for inventory setup
    Then product creation should open with inventory tracking enabled
    And when they save a tracked product
    Then the checklist should mark inventory activation as completed on next load

  Scenario: Opening a shift completes the shift step
    Given an owner has products and inventory
    When they open a shift on the register
    Then the checklist should mark shift opened as completed on next load
    And the dashboard should show a shift-opened success state with the sale action

  Scenario: Completing the first sale marks first sale complete
    Given an owner has products and an open shift
    When they complete the first sale
    Then the checklist should mark first sale as completed on next load
    And the dashboard should celebrate the milestone with a report action

  Scenario: Billing step reflects subscription or trial state
    Given an owner is still inside the signup trial
    When they open the checklist
    Then the billing step should show the trial status
    And selecting the step should navigate to billing

  Scenario: Cashier sees only the steps they can act on
    Given a cashier signs in
    When the dashboard checklist renders
    Then they should see only the shift and first-sale steps
    And owner-only steps should not be visible

  Scenario: Checklist falls back gracefully when sources fail
    Given the inventory API is unavailable
    When the dashboard checklist renders
    Then the inventory step should show a retryable status
    And the rest of the dashboard should still render

  Scenario: Setup and signup copy is localized
    Given the user is on the signup, login, or onboarding surfaces
    When the UI renders
    Then all visible strings should come from i18n keys
    And no string should mix English and Spanish unintentionally
