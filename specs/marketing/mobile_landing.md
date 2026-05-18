# Mobile Landing Spec

Status: Draft
Owner: Product/Frontend
Last updated: 2026-05-18

## Problem

The public landing page renders wider than the phone viewport. On iOS Safari this creates a visible
blank strip to the right and makes the first impression feel broken.

## Users

- Small business owners opening the product link on a phone.
- Founder/sales users sharing the landing page with beta leads.

## Requirements

- The landing page must have no horizontal overflow from 320 px upward.
- Desktop navigation links must be hidden on phone widths.
- The header must keep brand, theme toggle, and primary account CTA visible.
- The hero must fit without text clipping or horizontal scroll.
- The product showcase must adapt to phone width instead of pushing a desktop mockup off-canvas.
- Public landing mobile behavior must be protected by E2E tests.

## BDD Scenarios

```gherkin
Feature: Mobile public landing

  Scenario: Phone visitor opens the landing page
    Given a public visitor uses a 390 px wide viewport
    When they open the landing page
    Then the page has no horizontal overflow
    And the desktop navigation links are not visible
    And the primary create-account action is visible

  Scenario: Small phone visitor opens the landing page
    Given a public visitor uses a 320 px wide viewport
    When they open the landing page
    Then the page has no horizontal overflow
    And the hero headline and primary action remain readable

  Scenario: Visitor scrolls to the product showcase
    Given a public visitor uses a phone viewport
    When they open the product section
    Then the POS preview does not make the page wider than the viewport
```

## Test Matrix

| Viewport | Route | Expected |
| --- | --- | --- |
| 320 x 844 | `/` | No horizontal overflow |
| 390 x 844 | `/` | No horizontal overflow |
| 430 x 932 | `/` | No horizontal overflow |
| 768 x 1024 | `/` | No horizontal overflow |

## Acceptance Criteria

- Mobile landing has no horizontal scroll in automated tests.
- The nav desktop links are hidden below tablet width.
- Product showcase content stays within the viewport.
- Failure output names the widest overflowing elements.
