# Corrección local de picomatch — 17 de noviembre de 2026

## Alcance y decisión

El aviso [GHSA-fc5q-39xc-vjpf / CVE-2026-112366](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
afecta las versiones publicadas hasta 4.0.7. El registro sigue publicando 4.0.7 sin corrección
oficial declarada. Esta revisión incorpora una corrección local de fuentes para las cuatro
copias del frontend (4.0.4 y tres 2.3.2) y la copia 4.0.7 del gateway. No cambia el umbral de
HIGH/CRITICAL ni presenta los paquetes oficiales como libres del aviso.

Responsable del mantenimiento: mantenedores del repositorio Kova. Revisión automatizada de
Codex: comparación de fuentes y propuestas públicas, verificación de integridad, suite upstream,
regresiones aisladas y pruebas de Kova. No existe certificación externa ni aprobación atribuida
a los mantenedores de picomatch. El registro exacto está en
`frontend/scripts/security/picomatch/manifest.json`: revisado el 18 de noviembre a las
00:41:40 UTC, vence el 25 de noviembre de 2026 a las 00:41:40 UTC
(24 de noviembre, 18:41:40, Ciudad de México). No se renueva automáticamente.

## Fuentes e integridad

Las distribuciones se descargaron de `registry.npmjs.org`, conservando nombre y versión.
El lock del frontend carecía de `resolved` e `integrity` para su copia 4.0.4; se agregan los
datos reales del tarball oficial, sin cambiar su versión ni el árbol de dependencias.
Sólo cambia `lib/parse.js` de cada distribución. El manifiesto contiene SHA-512 del archivo
oficial y SHA-256 antes/después de cada archivo ejecutable y package.json. Incluye el hash
del runner y su número exacto de casos. Las fuentes se guardan como `.js.txt`, acompañadas
de diffs, licencias MIT y [procedencia completa](../../frontend/scripts/security/picomatch/README.md).

Se adaptaron partes de las propuestas públicas no fusionadas
[261](https://github.com/micromatch/picomatch/pull/261),
[262](https://github.com/micromatch/picomatch/pull/262) y
[263](https://github.com/micromatch/picomatch/pull/263), fijadas por commit en el manifiesto.
Se añadieron guardas locales para opciones, codificaciones y renderizado final. No se
incorporaron cambios ajenos al aviso del código aún no publicado.

## Pruebas del candidato

| Distribución | Regresiones aisladas | Suite upstream original | Control original vulnerable |
|---|---:|---:|---|
| 2.3.2 | 81/81 | 1970/1972 | timeout, rechazado |
| 4.0.4 | 82/82 | 1973/1975 | timeout, rechazado |
| 4.0.7 | 82/82 | 1981/1983 | timeout, rechazado |

No se cambiaron ni omitieron pruebas upstream. Los dos fallos de cada versión son los IDs:

- `options.maxExtglobRecursion should allow limited nested repeated extglobs when configured`
- `options.maxExtglobRecursion should disable the safeguard when maxExtglobRecursion is false`

Exigen generar repetición anidada o desactivar la protección. Este comportamiento cambia
intencionalmente: las opciones ya no reactivan la forma insegura. Las pruebas propias verifican
que las repeticiones literales anidadas simples conservan sus coincidencias. Los hashes del
archivo de prueba original, commits, conteos y resultados están en
`frontend/scripts/security/picomatch/upstream-evidence.json`. No se afirma que toda la suite
upstream esté verde; cualquier fallo funcional adicional requiere revisión.

Cada caso corre en un hijo con entorno vacío, heap V8 de 128 MiB, plazo de dos segundos y
salida acotada. El candidato debe terminar y acertar la aserción; un timeout no acredita éxito.
El análisis también tiene presupuestos de fuente, posiciones y operaciones. Las formas
complejas no demostradas se tratan como literales. No se promete equivalencia de capturas
para formas inseguras reescritas ni seguridad para cualquier RegExp crudo ajeno al aviso.

## Integración y límites

La instalación ejecuta npm sin hooks, verifica todas las copias y aplica la corrección antes
de reconstruir las dependencias. Comprueba otra vez los bytes y las regresiones después de
los hooks. CI, publicación, Docker, stack local y comandos documentados usan esta ruta.
Los comandos habituales del frontend y gateway comprueban los bytes antes de usar tooling.

La auditoría conserva los conteos originales: frontend 19 HIGH y 6 moderate; gateway 6 HIGH;
controladores de frontend y nativo sin HIGH/CRITICAL. Las hojas HIGH corresponden a este aviso;
las hojas moderate independientes mantienen el tratamiento ordinario de la política.
`npm-security-decisions.json` acredita la corrección separadamente. El gate reconstruye cada
versión desde npm, ejecuta las regresiones y compara el catálogo global actual, incluyendo
avisos sin revisar, malware y retirados. Un aviso nuevo o modificado, reporte incompleto,
versión desconocida, archivo alterado o revisión vencida bloquea.

La vigencia debe cerrarse con una versión oficial corregida o con una nueva revisión explícita
y evidencia actual. Su vencimiento impide instalaciones y publicaciones futuras; no añade
un temporizador a las ventas ni al resto de la aplicación ya desplegada.

## Validación de Kova

- Instalación completa protegida: cuatro copias del frontend y una del gateway verificadas
  después de reconstruir dependencias; todas las regresiones exigidas pasan.
- Auditoría npm de los cuatro locks: exit 0; raw original y decisión separada conservados.
  Catálogo global actual de seis ámbitos coincide con los tres GHSA revisados.
- Frontend: lint, tipos incluidos en build y build de producción aprobados; 254 archivos y
  1,962 pruebas unitarias aprobados, sin cambiar la selección respecto al árbol anterior.
- Navegador sobre el build: 22 escenarios aprobados de reglas, pendientes y caja, incluidos
  390/1440 px y venta encolada sin conexión. Estas APIs son simuladas; la validación con
  API/PostgreSQL/RLS reales del cambio de producto está en el expediente UX.
- Gateway: 28 pruebas focalizadas de empaquetado/runtime aprobadas. La aceptación completa
  de Workers y PostgreSQL corresponde a CI; no se confunde con estos tests locales.
- Contratos de publicación: 251 aprobados y 13 omisiones preexistentes condicionadas a navegador
  o plataforma. No se añadieron omisiones para este parche.
- Contratos del repositorio: 135 pruebas aprobadas; incluyen 25 del gate de backport.
  Las cuatro pruebas Node del instalador verifican orden, fallo cerrado, manipulación,
  copias adicionales y fechas. Ruff y diff-check aprobados.

CI required, aceptación completa de backend/Workers, imágenes y release siguen siendo
obligatorios para fusionar y publicar. Este registro local no declara el merge completado.

## Revisión del 24 de noviembre de 2026

La [auditoría semanal del 23 de noviembre](https://github.com/ArturoFrancoMozqueda/kova/actions/runs/45260553867)
detectó un cambio en el catálogo de picomatch. Se contrastó el artefacto de CI con
la [API oficial de GitHub](https://api.github.com/advisories/GHSA-fc5q-39xc-vjpf).
El único cambio en los tres registros fue la fecha `updated_at` del aviso retirado.
El registro npm seguía ofreciendo 4.0.7 como versión más reciente.

La auditoría local aprobó los cuatro lockfiles, consultó los seis ámbitos del
catálogo y reconstruyó desde npm las versiones 2.3.2, 4.0.4 y 4.0.7.
La verificación incluyó integridades, hashes y 81, 82 y 82 comprobaciones aisladas,
respectivamente. Se conservaron las recetas de los parches y los umbrales de CI.
La revisión registrada abarca de `2026-11-25T01:49:43Z` a `2026-12-02T01:49:43Z`.
