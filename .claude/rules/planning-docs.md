---
paths:
  - "docs/**/*.md"
  - "specs/**/*"
  - "**/*sprint*"
  - "**/*roadmap*"
  - "**/*backlog*"
---

# Planning and Documentation Rules

Planning docs should help Kova become production-ready, sellable, and scalable.

## Rules

- Keep tasks actionable, scoped, and testable.
- Separate must-have launch blockers from nice-to-have polish.
- Do not mark work complete unless code and validation support it.
- Do not invent implementation status.
- Link product goals to concrete technical work.
- Include owner/user impact, affected files/areas, acceptance criteria, and QA notes when writing stories.

## Documents

- If a document and the code disagree, the code wins; fix the document in the same change.
- Do not duplicate what the code already says; link the file instead.
- Dated audits, plans and reports are temporary. When they close, move the still-valid conclusions
  into a base document, ADR or runbook and delete the file; git keeps the history.
- ADRs are not edited to reflect change: write a new ADR that replaces the old one.
- Feature specs follow `specs/README.md`.
- Edits to `docs/**/*.md` alone do not trigger a production release; `AGENTS.md`, `CLAUDE.md` and
  `.claude/` do.
