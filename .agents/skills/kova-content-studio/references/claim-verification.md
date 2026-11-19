# Verificación eficiente de afirmaciones

Aplica este flujo cuando el contenido diga o implique algo comprobable sobre Kova, una oferta, el mercado o un cliente. No lo cargues para una pieza puramente editorial que no contenga esas afirmaciones.

## 1. Clasifica antes de buscar

- **Escena o tensión:** una situación narrativa como “el cierre no cuadra” no afirma que Kova la resuelva. No requiere investigación si no se presenta como caso real.
- **Posicionamiento:** qué es Kova y para quién existe. Verifica en `docs/claude/product-context.md` y `.claude/rules/brand-ux-copy.md`.
- **Comportamiento del producto:** una función, automatización, permiso, integración, actualización o resultado visible. Verifica en la implementación o contrato actual y en su prueba relacionada; una captura sólo demuestra lo que se ve.
- **Comercial o sensible:** precio, plan, promoción, impuestos, disponibilidad, seguridad, rendimiento o soporte. Requiere una fuente vigente y específica del dominio. Para billing, sigue también `.claude/rules/billing-stripe.md` y las fuentes que esa regla indique.
- **Mercado o cliente:** estadísticas, comparativas, testimonios, métricas y resultados. Requiere fuente identificable; un cliente real exige permiso y anonimización cuando corresponda.

## 2. Busca con límite

Usa primero el material aprobado por el usuario. Si hace falta el repositorio, busca el término exacto y abre el conjunto mínimo de archivos relacionados. Orden de preferencia:

1. configuración, contrato/API, migración o implementación vigente;
2. pruebas que confirmen el comportamiento;
3. regla de dominio o documentación mantenida;
4. captura sanitizada para probar únicamente lo visible.

Detén la búsqueda cuando una fuente autoritativa sostenga el claim y no exista una contradicción conocida. No recorras todo el repositorio “por si acaso”. Para capturas de marketing, empieza por `frontend/public/showcase/README.md` y `docs/marketing-showcase.md`.

Si dos fuentes discrepan, no elijas silenciosamente: prioriza la fuente ejecutable o contractual del dominio y registra la discrepancia. Si no hay checkout de Kova disponible, omite el claim o formula la pieza sin depender de él; pregunta sólo cuando sea esencial para el encargo.

## 3. Decide el texto

- **Verificado:** usa sólo el alcance exacto que demuestra la fuente.
- **Parcial:** reduce el claim a la parte comprobada.
- **No verificado:** conviértelo en tensión, pregunta o posibilidad sin atribuir a Kova un resultado; si eso cambia la promesa central, omítelo.
- **Pendiente de aprobación:** puede aparecer como marcador en un borrador interno, nunca en el asset final.

“La pantalla muestra X” no prueba ahorro, crecimiento, exactitud futura ni causalidad. Una capacidad técnica tampoco prueba que esté disponible en todos los planes, cuentas o entornos.

## Registro mínimo

Antes de publicar conserva, en el brief o archivo de trabajo, una línea por claim:

```text
<claim literal> | verificado / parcial / omitido | <fuente y revisión o fecha> | <alcance o condición>
```

En la entrega informa las fuentes de los claims publicables y resume sólo lo reformulado, omitido o pendiente. No expongas rutas internas ni detalles sensibles dentro del copy público.
