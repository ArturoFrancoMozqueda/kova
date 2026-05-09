Feature: Catalog foundation
  Tenant owners need a tenant-scoped catalog before they can sell products.

  @p0 @catalog @tenant-isolation @audit @idempotency
  Scenario: Tenant owner creates and lists a category and product
    Given a verified tenant owner for catalog setup
    When the owner creates a catalog category named "Pan dulce"
    And creates a product named "Concha" priced at "18.50" in that category
    Then the owner sees the category in their catalog
    And sees the product in their catalog

  @p0 @catalog @permission
  Scenario: Cashier cannot create catalog products
    Given a verified tenant cashier for catalog setup
    When the cashier tries to create a product
    Then the catalog request is rejected with permission denied

  @p0 @catalog @tenant-isolation
  Scenario: Tenants cannot see each other's catalog products
    Given two verified tenant owners for catalog isolation
    When the first tenant creates a product named "Tenant A Concha"
    Then the second tenant cannot see "Tenant A Concha" in their catalog
