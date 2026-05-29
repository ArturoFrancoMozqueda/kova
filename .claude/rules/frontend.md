---
paths:
  - "frontend/**/*"
  - "src/**/*"
  - "**/*.tsx"
  - "**/*.ts"
  - "**/*.jsx"
  - "**/*.js"
  - "**/*.css"
  - "**/*.scss"
---

# Frontend Rules

Kova frontend should feel premium, fast, clear, and trustworthy.

## Product principles

- Build for Mexican SMB owners who may not be technical.
- The interface should feel worth paying for, not like a generic admin template.
- Prioritize clarity over feature density.
- Preserve Spanish/es-MX copy unless the task explicitly asks for another language.
- Avoid AI-ish copy, vague promises, and generic SaaS filler.

## Frontend safety

- Do not store auth tokens in localStorage/sessionStorage.
- Do not bypass backend or RLS with direct unsafe data access.
- Do not hardcode production data, analytics, subscription status, or tenant IDs.
- Do not add fake/demo data to production views.
