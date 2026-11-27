# ADR-042 — libxml2 oficial de Alpine en el parser aislado

Estado: aceptada por el dueño el 26 de noviembre de 2026.
Fecha: 2026-11-26.

## Contexto

El parser aislado usaba una compilación local de libxml2 2.13.9, etiquetada `r3`, con seis
backports de Kova y dos parches de referencia de Alpine, porque el paquete oficial todavía no
incluía esas correcciones. Seis pruebas C de caja blanca, que incluyen archivos `.c` de libxml2,
demostraban los backports sobre esa fuente.

Alpine 3.24 publicó `2.13.9-r4` y `2.13.9-r5` firmados. Según su receta, corrigen los mismos CVE
(CVE-2026-6732 y CVE-2026-86138 a 86144) y además CVE-2026-0989, 0990, 0992, 1757, 11979, 86137 y
86141. El escaneo marcó la compilación local como vulnerable, con razón: le faltaban esas
correcciones. El repositorio prohíbe reetiquetar una versión para ocultar un hallazgo.

## Decisión

1. Instalar el paquete firmado `libxml2=2.13.9-r5` y retirar la compilación local, sus parches y
   sus seis pruebas de caja blanca. Esas pruebas sólo validaban código que el parser ya no usa.
2. El gate de runtime acepta sólo esa versión exacta y exige que la biblioteca cargada tenga los
   mismos bytes que registró el paquete firmado en la base de datos de `apk` de la imagen.
3. Trivy sigue bloqueando cualquier hallazgo HIGH o CRITICAL, incluidos los no corregidos.

El dueño aprobó explícitamente retirar la compilación local y sus pruebas.

## Consecuencias

- Kova depende de las correcciones de Alpine para libxml2, igual que para el resto de sus
  paquetes, en lugar de mantener backports propios.
- Una versión nueva de libxml2 exige actualizar la versión fijada y el gate en el mismo cambio.
- Si Alpine vuelve a retrasar un aviso conocido, se evalúa una compilación local en un ADR nuevo.
