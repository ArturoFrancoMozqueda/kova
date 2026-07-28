import { STANDARD_PLAN, STANDARD_PLAN_AMOUNT } from "@/billing/standardPlan";
import { copy } from "@/i18n/messages";

// Single source of truth for the landing's structured data inputs. The
// prerender script (scripts/prerender.mjs) imports this via the SSR bundle to
// build the FAQPage and Offer JSON-LD, so FAQ copy and pricing can never
// drift from what the page actually renders.
export const LANDING_SEO = {
  faq: copy.landing.faq.items.map(({ q, a }) => ({ q, a })),
  price: String(STANDARD_PLAN_AMOUNT),
  currency: STANDARD_PLAN.currency,
} as const;
