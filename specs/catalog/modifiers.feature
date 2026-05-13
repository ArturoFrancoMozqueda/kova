Feature: Product modifiers
  Owners configure modifier groups so cashiers can customize products at point of sale.

  @p0 @catalog @modifiers @money
  Scenario: Owner creates modifier group, assigns to product, cashier orders with modifier
    Given a verified tenant owner with a product "Café Americano" priced at "45.00"
    And the owner creates modifier group "Size" with options "Small +0.00" and "Large +10.00"
    And the owner assigns "Size" to "Café Americano"
    When the cashier creates an order with "Café Americano" selecting modifier "Large"
    Then the order item unit price is "55.00"
    And the order item modifier snapshot records "Large" with price delta "10.00"

  @p0 @catalog @modifiers @money
  Scenario: Multiple modifier groups sum correctly
    Given a verified tenant owner with a product "Latte" priced at "50.00"
    And the owner creates modifier group "Size" with options "Regular +0.00" and "Large +10.00"
    And the owner creates modifier group "Milk" with options "Whole +0.00" and "Oat +8.00"
    And the owner assigns "Size" to "Latte"
    And the owner assigns "Milk" to "Latte"
    When the cashier creates an order with "Latte" selecting "Large" and "Oat"
    Then the order item unit price is "68.00"

  @p0 @catalog @modifiers
  Scenario: Required modifier not selected is rejected
    Given a verified tenant owner with a product "Concha" priced at "18.50"
    And the owner creates required modifier group "Flavor" with options "Vanilla +0.00" and "Chocolate +0.00"
    And the owner assigns "Flavor" to "Concha"
    When the cashier creates an order with "Concha" without selecting any modifiers
    Then the order is rejected with modifier validation error

  @p0 @catalog @modifiers @permission
  Scenario: Cashier cannot create modifier groups
    Given a verified tenant cashier
    When the cashier attempts to create a modifier group
    Then the catalog request is rejected with permission denied

  @p0 @catalog @modifiers @tenant-isolation
  Scenario: Modifier groups are tenant-scoped
    Given two verified tenant owners
    When the first tenant creates a modifier group "Secret Size"
    Then the second tenant cannot see "Secret Size" in their modifier groups
