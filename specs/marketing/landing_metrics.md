# Landing Metrics Spec

Status: Draft
Owner: Product/Marketing
Last updated: 2026-05-18

## Problem

Public landing claims must not imply production traction, processed volume, or customer counts that
cannot be backed by real data.

## Requirements

- Do not show live customer counts, processed sales volume, or active business counts unless they
  come from a documented production data source.
- Illustrative or aspirational claims must be worded as product positioning, not metrics.
- Any future metric shown on the landing page must define source, freshness, owner, and fallback
  behavior.

## Current Decision

The previous `247 negocios activos ahora mismo` claim is removed from the hero because it is not
backed by a production source.

The replacement copy is qualitative: `Beta privada para negocios reales`.

## Acceptance Criteria

- Landing copy contains no unverifiable active-business count.
- New landing metrics require a documented data source before release.
