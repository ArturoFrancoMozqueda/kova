# Playbook de campo para 10 pilotos de Kova

Estado: material listo para uso; la evidencia de campo todavía debe obtenerse con negocios reales.

Este playbook ejecuta las acciones 9–12 del
[`PLAN-GROWTH-EXECUTION.md`](../plans/PLAN-GROWTH-EXECUTION.md) sin inventar pilotos, entrevistas ni
prueba social. El foco inicial son cafeterías y panaderías de una sola ubicación.

## Meta y definición de piloto activo

- Visitar 20 negocios por semana durante seis semanas.
- Hacer una demo de 10 minutos en el mostrador cuando el dueño o responsable pueda atender.
- Ofrecer configuración asistida en el momento, sin tarjeta y con la prueba vigente de 7 días.
- Un negocio cuenta para el gate de producto sólo después de registrar al menos una venta completada
  en cada una de cuatro semanas consecutivas.
- La meta se cierra con 10 negocios que cumplan esa definición; registros, demos o cuentas creadas
  no cuentan como pilotos activos.

## Registro seguro

Los datos de contacto viven en el CRM o archivo privado autorizado, nunca en git. En el repositorio
sólo se registra evidencia anonimizada con estos campos:

| Campo | Valores permitidos |
|---|---|
| `pilot_code` | Código `P-01` a `P-10`; no nombre comercial |
| `vertical` | `cafeteria`, `panaderia` u `otro` |
| `demo_date` | Fecha o vacío |
| `first_sale_date` | Fecha o vacío |
| `active_week_1` … `active_week_4` | `yes` / `no` |
| `interview_status` | `not_asked`, `consented`, `completed`, `declined` |
| `primary_blocker` | Código de la taxonomía inferior |
| `next_step` | Acción sin nombre, teléfono, correo ni texto sensible |
| `last_follow_up` | Fecha |

Taxonomía inicial de bloqueos: `cfdi`, `card_integration`, `setup_time`, `catalog_load`, `price`,
`workflow_fit`, `trust`, `email_delivery`, `missing_feature`, `no_urgency`, `unknown`. No crees una
categoría nueva por una sola conversación: conserva la nota privada y revisa patrones cada semana.

## Apertura de 30 segundos

> Hola. Estoy probando Kova con cafeterías y panaderías de la zona. Registra la venta y usa ese mismo
> dato para actualizar inventario, cuadrar caja y mostrar qué se vende y a qué hora. Busco 10 negocios
> para probarlo cuatro semanas con acompañamiento directo. ¿Te puedo enseñar en 10 minutos y tú me
> dices si encaja con cómo trabajan aquí?

Si la persona no decide sobre la operación, pide un horario para volver; no presiones al personal ni
captures sus datos sin permiso.

## Demo de 10 minutos

1. **Minuto 0–1 — situación actual.** Pregunta: “Cuando termina el día, ¿cómo sabes cuánto vendiste,
   qué se está acabando y si la caja cuadró?”. Escucha antes de mostrar producto.
2. **Minuto 1–3 — una venta realista.** Arma un ticket, elige la forma de pago y completa la venta.
   Aclara que “tarjeta” registra el método; Kova no procesa el cargo.
3. **Minuto 3–5 — efecto operativo.** Enseña el descuento de inventario y el movimiento del turno.
4. **Minuto 5–7 — valor diferencial.** Abre Análisis y responde sólo con datos visibles: qué se
   vendió, en qué horario y qué requiere atención. No prometas causalidad ni pronósticos inexistentes.
5. **Minuto 7–9 — prueba de encaje.** Pregunta qué parte le ahorraría trabajo y qué impediría usarlo
   mañana. Registra la respuesta con la taxonomía, no la rebatas de inmediato.
6. **Minuto 9–10 — siguiente paso.** Si hay encaje: “Lo dejamos listo hoy. Tienes 7 días sin tarjeta;
   después es un solo plan de $299 MXN al mes. ¿Cargamos tus productos principales y hacemos la
   primera venta?”. Si no hay encaje, pide permiso para una entrevista breve y cierra sin presión.

## Respuestas obligatorias a las dos objeciones críticas

### “¿Puedo facturar desde Kova?”

> Hoy Kova no emite CFDI. Puedes mantener tu proceso fiscal actual y usar Kova para caja, inventario
> y análisis. CFDI está en el roadmap mediante un PAC verificado, pero no prometemos una fecha hasta
> validarlo con 10 pilotos. Si facturar dentro del POS es indispensable hoy, Kova todavía no reemplaza
> esa parte de tu operación.

### “¿Kova cobra la tarjeta o se conecta con mi terminal?”

> Hoy Kova registra la forma de pago para que el corte cuadre, pero el cobro se procesa por separado
> en tu terminal de Clip, Mercado Pago u otro proveedor. La integración está diferida hasta validar
> demanda y proveedor con 10 pilotos. No presentamos el registro manual como cobro integrado.

Nunca sustituyas estas respuestas por “próximamente” ni prometas trimestre, proveedor o precio.

## Entrevista de abandono o no activación

### Consentimiento

> Queremos entender por qué Kova no encajó en tu operación. Son 15 minutos; participar es voluntario
> y no cambia tu cuenta. Usaremos tus respuestas de forma anonimizada para mejorar el producto. ¿Nos
> autorizas tomar notas sin incluir tu nombre ni datos del negocio en el reporte?

Registra `declined` si no acepta y no insistas. No grabes audio sin un consentimiento separado y
explícito.

### Preguntas conductuales

1. Cuéntame la última vez que cerraste caja. ¿Qué pasos seguiste y qué herramienta usaste?
2. Antes de abrir Kova, ¿qué esperabas resolver primero?
3. ¿Hasta qué paso llegaste la última vez que lo usaste? ¿Qué ocurrió después?
4. ¿Qué fue más difícil o tomó más tiempo de lo esperado?
5. ¿Qué seguiste usando en lugar de Kova y por qué?
6. La última vez que necesitaste saber qué producto se vendía o se estaba acabando, ¿cómo lo
   averiguaste?
7. ¿En qué momento surgió la necesidad de factura o cobro con tarjeta? ¿Qué haces hoy?
8. ¿Qué tendría que ser distinto para que hicieras ventas con Kova la próxima semana?
9. Si Kova desapareciera hoy, ¿qué perderías, si acaso?

No vendas durante las primeras ocho preguntas. Pide ejemplos del último caso real y evita preguntas
hipotéticas del tipo “¿usarías…?”.

## Síntesis semanal

- Separa cafeterías y panaderías antes de concluir que un patrón aplica a ambas.
- Reporta frecuencia e intensidad por bloqueo; una respuesta aislada tiene confianza baja.
- Usa confianza media con dos fuentes y alta con tres o más fuentes independientes que mencionan el
  tema sin ser dirigidas.
- No cambies posicionamiento ni abras una feature por menos de cinco observaciones del mismo segmento.
- Cierra cada semana con conteos: visitas, demos, configuraciones, primeras ventas, pilotos con semanas
  activas e entrevistas consentidas/completadas. No mezcles cuentas de prueba internas.

## Criterio de cierre de las acciones 9–12

- **Acción 9:** 10 códigos con cuatro semanas activas y seguimiento fechado.
- **Acción 10:** el guion se usó en demos y existe síntesis anonimizada sobre si el análisis generó
  interés o valor.
- **Acción 11:** las respuestas de CFDI y tarjeta se usaron y se registraron objeciones reales sin
  prometer alcance ni fecha.
- **Acción 12:** entrevistas consentidas completadas y causas de abandono sintetizadas por tema y
  confianza; no se requiere ni se permite PII en el reporte versionado.
