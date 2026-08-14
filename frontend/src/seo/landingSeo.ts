import { STANDARD_PLAN, STANDARD_PLAN_AMOUNT } from "@/billing/standardPlan";
import { copy } from "@/i18n/messages";

// Single source of truth for the landing's structured-data inputs. The
// prerender script imports this via the SSR bundle, so the Offer price comes
// from the same billing constant the UI renders. FAQ stays available here for
// a future FAQPage only if search policy calls for one.
export const LANDING_SEO = {
  faq: copy.landing.faq.items.map(({ q, a }) => ({ q, a })),
  price: String(STANDARD_PLAN_AMOUNT),
  currency: STANDARD_PLAN.currency,
} as const;
