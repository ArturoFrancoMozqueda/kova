# Specs

Feature specifications should live here.

Every P0/P1 user-facing business feature should include:

- Problem statement
- Target users
- Business value
- Functional requirements
- Non-functional requirements
- Gherkin scenarios
- Data model impact
- API impact
- Permissions
- Offline behavior if applicable
- Error states
- Audit log behavior
- Test matrix
- Acceptance criteria

## Qué hay aquí

- `.md`: contrato funcional vigente de cada dominio.
- `.feature`: escenarios Gherkin que ejecuta `backend/app/tests/bdd/`.
- `openapi.json`: contrato de la API, regenerado con `backend/scripts/export_openapi.py`.

Si una spec deja de describir el producto, se actualiza en el mismo PR que cambia el código o se
retira. Las specs de los sprints 0–6 que el código ya superó se retiraron el 2026-10-28; siguen en
el historial de git.
