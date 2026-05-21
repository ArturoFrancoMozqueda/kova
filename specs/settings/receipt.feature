Feature: Receipt settings
  Owners configure the receipt shown to customers.

  Scenario: Fresh tenant opens receipt settings
    Given an owner has signed up and verified a new tenant
    When the owner opens receipt settings
    Then the API returns a valid initial receipt configuration
    And the response uses the tenant name as the receipt business name
    And the response is not a 404

  Scenario: Owner saves receipt settings
    Given an owner is authenticated for their tenant
    When the owner saves receipt settings
    Then the settings are stored for that tenant
    And an audit log records the update

