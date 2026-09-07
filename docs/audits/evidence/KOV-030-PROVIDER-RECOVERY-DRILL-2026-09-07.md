# KOV-030 — recuperación real Fly/Vercel por fase

**Fecha:** 2026-09-07  
**Workflow:** `Disposable provider recovery drill`  
**Ejecución aprobada:** [GitHub Actions 34161542321](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/34161542321)  
**Commit ejecutado:** `1a3162f9edd89e0f6db8385d54be7c3c23916a9f`

## Resultado

El ensayo real terminó **PASS** sobre una app Fly y un proyecto Vercel desechables. El workflow
creó un baseline `111111111111`, desplegó un candidato `222222222222`, inyectó una falla controlada
en cada fase y recuperó el par anterior con el script versionado. No se usaron base de datos,
dominios, proyectos, aplicaciones ni secretos de producción.

| Fase | Resultado |
|---|---|
| Baseline | Frontend, hash, Fly `/health`, `/health/db` y proxies Vercel→Fly en verde |
| `candidate` | Restauró la imagen Fly exacta y verificó nuevamente el baseline |
| `promotion` | Restauró Vercel primero y Fly después; el par anterior quedó coherente |
| `acceptance` | Verificó el candidato, simuló falla posterior y restauró el par anterior |
| Artefacto | `rollback.json` obligatorio, transferido mediante artifact con `if-no-files-found: error` |
| Evidencia | Artifact redactado con run, commit, resultado y las tres fases |
| Limpieza | Proyecto Vercel y app Fly eliminados; verificación final PASS |

## Recursos y aislamiento

- Nombre efímero: `kova-kov030-34161542321-1`, derivado de run y attempt.
- Guardas rechazaron nombres que no cumplieran el prefijo único y cualquier coincidencia con los
  identificadores productivos configurados.
- El token Fly fue un token de organización con vigencia de una hora creado exclusivamente para el
  drill; el secret temporal `KOV030_FLY_API_TOKEN` se eliminó de GitHub al terminar.
- Una verificación independiente posterior confirmó que la app Fly ya no existe y que el listado de
  Vercel sólo conserva `kova-web` y `ceneval-study-app`.

## Fallas encontradas y corregidas durante el ensayo

Los intentos previos fallaron de forma segura antes de completar el drill y siempre ejecutaron la
limpieza y su verificación:

1. El workflow sin `contents: read` no podía hacer checkout del repositorio privado.
2. El token Fly productivo era correctamente app scoped y no podía crear recursos; se sustituyó en
   este workflow por un secret dedicado y temporal.
3. Vercel requería enlazar explícitamente el ID del proyecto recién creado al entorno del CLI.
4. Un proyecto Vercel nuevo requería confirmar sus settings por medio de `deploy --yes`.

Cada corrección se integró desde una rama `feature/` independiente. Ningún intento apuntó a
producción y todos terminaron sin recursos efímeros residuales.

## Validación local y de CI

- `node --test scripts/release-recovery.test.mjs`: 8 PASS, incluida ejecución real de `npx` en
  Windows sin `spawn EINVAL`.
- `npm run test:release-contract`: 11 PASS.
- `pytest scripts/tests/test_check_ops_readiness.py`: 12 PASS.
- `python scripts/check_ops_readiness.py repository`: PASS.
- `actionlint` 1.7.7: PASS.
- Workflow real: todas las fases, artifact, limpieza y verificación final PASS.

El workflow permanece exclusivamente manual, exige la frase de confirmación literal y falla cerrado
si falta un secret, el artifact de rollback está vacío o el objetivo no es desechable.
