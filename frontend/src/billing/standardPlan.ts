export const STANDARD_PLAN = {
  name: "Standard Plan",
  amountMinorUnits: 19_900,
  currency: "MXN",
  interval: "month",
} as const;

export const STANDARD_PLAN_AMOUNT = STANDARD_PLAN.amountMinorUnits / 100;
export const STANDARD_PLAN_PRICE = `$${STANDARD_PLAN_AMOUNT}`;
export const STANDARD_PLAN_PRICE_LABEL = `${STANDARD_PLAN_PRICE} ${STANDARD_PLAN.currency}/month`;
export const STANDARD_PLAN_PRICE_CADENCE = `${STANDARD_PLAN.currency}/month`;
export const STANDARD_PLAN_PRICE_CADENCE_ES = `${STANDARD_PLAN.currency} / mes`;
export const STANDARD_PLAN_PRICE_LABEL_ES = `${STANDARD_PLAN_PRICE} ${STANDARD_PLAN.currency}/mes`;
