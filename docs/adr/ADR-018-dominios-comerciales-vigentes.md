# ADR-018: Las reglas de dominios comerciales están vigentes

## Estado

Aceptada el 2026-10-28. Reemplaza el estado "Propuesto" de
[ADR-016](ADR-016-commercial-domain-foundations.md); sus diez reglas no cambian.

## Contexto

ADR-016 se escribió como propuesta para descuentos, impuestos, compras, variantes y conciliación,
con la implementación bloqueada por gates de un plan de crecimiento ya retirado. Desde entonces el
propietario autorizó esa expansión (2026-10-05) y el código ya incluye los módulos
`backend/app/pricing`, `purchasing`, `reconciliation`, `fiscal` y `cfdi`, publicados en `main`.
Leer ADR-016 como "propuesta" hoy invita a tratar sus reglas como opcionales.

## Decisión

1. Las diez reglas de la sección "Decisión" de ADR-016 son obligatorias para todo el código de
   precios, descuentos, impuestos, variantes, compras, recepciones, conciliación y snapshots
   fiscales, existente o nuevo.
2. Los "Gates de implementación" de ADR-016 dejan de bloquear el desarrollo. Los que siguen
   aplicando se tratan como gates de activación en `docs/current-sprint.md`:
   - CFDI Live exige revisión fiscal, emisor real y aceptación Test con el PAC antes de emitir.
   - La conciliación productiva exige el formato real de al menos un adquirente o banco.
3. Ninguna funcionalidad fiscal se presenta como CFDI emitido sin timbrado confirmado por el PAC.

## Consecuencias

- Una revisión de código que encuentre totales reconstruidos desde valores actuales, `float` en
  dinero o mutaciones fiscales offline lo trata como defecto, no como deuda aceptada.
- Cambiar cualquiera de las diez reglas exige un ADR nuevo que reemplace a este y a ADR-016.
