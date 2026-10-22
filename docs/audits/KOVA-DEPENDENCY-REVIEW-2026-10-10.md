# Revisión de dependencias frontend

Fecha: 10 de octubre de 2026. Alcance: dependencias registradas en el lockfile,
advisories vigentes del registro npm y compatibilidad de la herramienta de pruebas
y del compilador CSS. No se leyeron credenciales ni archivos de entorno.

## Resultado

| Auditoría del lockfile | Antes | Después |
| --- | --- | --- |
| Producción, `npm audit --omit=dev` | 0 | 0 |
| Completa, críticos | 2 | 0 |
| Completa, altos | 5 | 5 |
| Completa, moderados | 3 | 0 |

Los diez paquetes afectados inicialmente eran dependencias de desarrollo o
compilación. La auditoría completa queda con cinco paquetes de severidad alta,
todos derivados del mismo advisory sin parche de `braces`; no se declara una
auditoría completa sin vulnerabilidades ni preparación de producción al 100%.

## Cambios y fuentes primarias

- `vitest` pasa de la rama 3 (lockfile 3.2.7) a 4.1.11. El registro npm mantiene
  3.2.7 como último backport de la rama 3, todavía afectado por la lectura arbitraria
  de archivos del interceptor público de mocks. La versión 4.1.11 está corregida y
  elimina `tinypool` del árbol. Se resuelven también sus dos gadgets críticos de
  prototype pollution. Fuentes: [Vitest/mocker](https://github.com/advisories/GHSA-82fw-gwwq-j7x9),
  [tinypool Worker](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3),
  [tinypool Process](https://github.com/advisories/GHSA-85c8-ppgw-ccpr),
  [registro Vitest](https://registry.npmjs.org/vitest) y
  [migración oficial de Vitest 4](https://v4.vitest.dev/guide/migration).
- El override de `postcss-selector-parser` pasa de 6.1.3 a 7.1.6, versión corregida
  para el consumo cuadrático de CPU con selectores planos adversariales. No se
  actualiza Tailwind. Fuente: [advisory del parser](https://github.com/advisories/GHSA-rj75-hqrm-r3gf).
- La implementación mock de `fetch` en `funnel.test.ts` recibe un tipo callable
  explícito: Vitest 4 permite mocks de constructores además de funciones. Sólo se
  adapta el tipo de una función que ya devuelve `Promise<Response>`; no cambian
  entradas, expectativas ni verificaciones.

Ninguna dependencia runtime cambia de versión. El lockfile elimina `tinypool` y
actualiza la familia de paquetes internos de Vitest y el parser CSS.

## Vulnerabilidad pendiente y alcance real

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
afecta `braces <=3.0.3` mediante patrones con anidamiento extremo que agotan la
pila; el advisory no publica una versión corregida. El
[registro del paquete](https://registry.npmjs.org/braces) todavía señala 3.0.3
como última versión. npm propaga el aviso a `braces`, `micromatch`, `fast-glob`,
`chokidar` y `tailwindcss`.

La compilación de Kova usa patrones estáticos y revisados en
`frontend/tailwind.config.js`: `./index.html` y `./src/**/*.{js,ts,jsx,tsx}`.
El flujo de producción no permite a los tenants suministrar esos patrones ni
ejecuta este compilador desde sus peticiones. Eso limita la superficie observada,
sin borrar el riesgo residual de la herramienta de desarrollo. La remediación
automática propuesta por npm exige migrar a Tailwind 4; ese cambio requiere una
revisión independiente de diseño y compatibilidad y no se ejecuta con
`npm audit fix --force`. Cuando exista un parche compatible se deberá reevaluar
esta cadena; no hay una excepción silenciosa ni una afirmación de riesgo cero.

El check de CI anterior sólo auditaba producción con severidad alta. Por eso podía
estar verde mientras `npm ci` notificaba críticos de desarrollo. CI conserva ese
gate y añade `npm audit --audit-level=critical --package-lock-only` para impedir
que reaparezcan críticos en el árbol completo.

## Validación

Se instalaron baseline y candidato separados en directorios temporales, con npm
oficial 12.2.0 cuya descarga se verificó con la integridad SHA-512 del registro.
El candidato completó 160 archivos y 965 pruebas unitarias (snapshot previo a las
dos regresiones de autenticación adicionales del equipo), ESLint, TypeScript,
build cliente, build SSR y prerender de cinco páginas. Pasaron también contratos
OpenAPI, escaneo de secretos del bundle (100 archivos JS) y contratos de release
(24 pruebas; una exclusiva de Windows omitida en macOS).

La comparación CSS encontró tres de cuatro assets idénticos byte a byte. El CSS
principal conserva todas las reglas previamente emitidas y agrega once reglas
para clases existentes `group-hover`, `group-open` y `peer-disabled`. Una
reproducción mínima con el mismo Tailwind 3.4.19 confirma que el override 6.1.3
omitía esas variantes y el parser 7.1.6 genera los selectores y declaraciones
esperados. Se verificaron las clases fuente de Dashboard, catálogo, etiqueta y
componentes UI. No se afirma equivalencia byte a byte del CSS principal: se
restauran estilos declarados que antes faltaban, sin modificar reglas existentes.

La instalación `npm ci` del checkout actualizado terminó correctamente. Las
auditorías posteriores reproducen cero vulnerabilidades runtime y cero críticos
en el árbol completo. El equipo ejecuta además la suite y QA de navegador del
checkout final que incluye los cambios de autenticación.
