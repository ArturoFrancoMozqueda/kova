Feature: Auth happy path
  A tenant owner can sign up, verify their email, log in, and read their
  tenant-scoped session data.

  @p0 @auth
  Scenario: Tenant owner signs up, verifies email, logs in, and sees tenant data
    Given a prospective tenant owner
    When the owner signs up
    And verifies their email
    And logs in
    Then the owner can read tenant-scoped session data for "BDD Bakery"
