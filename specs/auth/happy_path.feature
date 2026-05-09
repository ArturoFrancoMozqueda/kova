Feature: Auth happy path
  The platform must prove the spec-driven BDD harness before POS features begin.

  @p0 @auth @bdd
  Scenario: Tenant owner signs up, verifies email, logs in, and sees tenant data
    Given a prospective tenant owner
    When the owner signs up
    And verifies their email
    And logs in
    Then the owner can read tenant-scoped session data for "BDD Bakery"
