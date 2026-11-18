# ADR-038 — Verificación de una corrección local de picomatch

Fecha: 2026-11-17
Estado: aceptado para el candidato validado; publicación sujeta a CI required.

## Contexto

El aviso [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
se amplió a las versiones publicadas hasta 4.0.7. Afecta herramientas de compilación y
pruebas de frontend y gateway; las versiones ya publicadas en npm no contienen una
corrección oficial completa. Actualizar únicamente el número de versión no resuelve
el problema. El PR de producto sigue sujeto a `CI required`.

## Decisión

Se admite una corrección local verificable, con vigencia máxima de siete días,
para las distribuciones exactas 2.3.2, 4.0.4 y 4.0.7. Se conservan los nombres,
versiones, URLs e integridades de los lockfiles. No se usa una versión ficticia,
una exclusión general del aviso ni un cambio de severidad.

`frontend/scripts/security/install.mjs` instala primero con `--ignore-scripts`,
comprueba el inventario completo y los hashes de las distribuciones, reemplaza
únicamente el parser revisado y entonces ejecuta los hooks de dependencias.
Después vuelve a comprobar los bytes y corre regresiones en procesos separados
con tiempo y memoria limitados, sin credenciales de la aplicación. Los comandos
habituales de build y test también comprueban el inventario instalado.

La auditoría conserva los JSON originales de npm. Un reporte separado acredita
la remediación de cada copia; todo HIGH debe conducir exclusivamente al aviso y
las versiones revisadas. Un CRITICAL, otro aviso HIGH, un grafo incompleto o un
error de herramienta bloquea. Aunque npm reporte cero, la presencia de estas
copias exige la misma comprobación del backport y del catálogo global upstream.

El gate reconstruye las tres distribuciones desde el registro oficial, verifica
su integridad y sus fuentes antes y después del cambio y repite las regresiones.
Consulta los avisos globales revisados, sin revisar, de malware y retirados;
un cambio en el catálogo, una consulta incompleta o una revisión vencida bloquea.
El registro de revisión identifica alcance, responsable, evidencia y vencimiento.

## Consecuencias y salida

Esta decisión acredita los bytes de Kova y no declara corregida la distribución
oficial de npm. Las restricciones conservadoras del parser y los resultados
upstream se documentan en el expediente de validación, junto con las pruebas de
Kova. No certifica que cualquier expresión regular externa sea segura.

La vigencia no se renueva automáticamente. Antes de vencer se debe revisar el
catálogo, repetir las comprobaciones y registrar la evidencia del candidato, o
migrar explícitamente a una versión oficial corregida. La migración debe retirar
este mecanismo, actualizar los locks reales y pasar compatibilidad y auditoría.
El vencimiento bloquea instalaciones y publicaciones futuras, sin introducir
este control dentro de los flujos de caja de los clientes.
