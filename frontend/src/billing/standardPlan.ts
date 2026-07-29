export const STANDARD_PLAN = {
  name: "Plan Standard",
  amountMinorUnits: 29_900,
  currency: "MXN",
  interval: "month",
} as const;

export const STANDARD_PLAN_AMOUNT = STANDARD_PLAN.amountMinorUnits / 100;

// Reencuadre "≈ $X al día" para la landing. Divisor 30 = mes comercial. Es un
// DERIVADO del precio real (no una métrica inventada — specs/marketing/
// landing_metrics.md); todo copy que lo use debe llevar el "≈".
export const STANDARD_PLAN_DAILY_APPROX = Math.round(STANDARD_PLAN_AMOUNT / 30);
export const STANDARD_PLAN_PRICE = `$${STANDARD_PLAN_AMOUNT}`;
export const STANDARD_PLAN_PRICE_LABEL = `${STANDARD_PLAN_PRICE} ${STANDARD_PLAN.currency}/mes`;
export const STANDARD_PLAN_PRICE_CADENCE = `${STANDARD_PLAN.currency} / mes`;
export const STANDARD_PLAN_PRICE_CADENCE_ES = `${STANDARD_PLAN.currency} / mes`;
export const STANDARD_PLAN_PRICE_LABEL_ES = `${STANDARD_PLAN_PRICE} ${STANDARD_PLAN.currency}/mes`;
