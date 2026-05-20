import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowRight, BarChart3, LayoutGrid, ShoppingCart, X } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { trackFunnelEvent } from "@/telemetry/funnel";

type TourKey = "register" | "catalog" | "reports";

const tours: Record<TourKey, { icon: typeof ShoppingCart; title: string; body: string; bullets: string[]; cta: string }> = {
  register: {
    icon: ShoppingCart,
    title: copy.tour.registerTitle,
    body: copy.tour.registerBody,
    bullets: copy.tour.registerBullets,
    cta: copy.tour.registerCta,
  },
  catalog: {
    icon: LayoutGrid,
    title: copy.tour.catalogTitle,
    body: copy.tour.catalogBody,
    bullets: copy.tour.catalogBullets,
    cta: copy.tour.catalogCta,
  },
  reports: {
    icon: BarChart3,
    title: copy.tour.reportsTitle,
    body: copy.tour.reportsBody,
    bullets: copy.tour.reportsBullets,
    cta: copy.tour.reportsCta,
  },
};

function tourKey(pathname: string): TourKey | null {
  if (pathname === "/register") return "register";
  if (pathname === "/catalog") return "catalog";
  if (pathname === "/reports") return "reports";
  return null;
}

export function FirstUseTour() {
  const location = useLocation();
  const { state } = useAuth();
  const key = tourKey(location.pathname);
  const storageKey = useMemo(() => {
    if (!key || state.status !== "authenticated") return null;
    return `kova:tour:${state.tenantId}:${key}`;
  }, [key, state]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!storageKey || !key) {
      setOpen(false);
      return;
    }
    try {
      const seen = window.localStorage.getItem(storageKey);
      setOpen(!seen);
      if (!seen) void trackFunnelEvent("onboarding_tour_viewed", { tour: key });
    } catch {
      setOpen(false);
    }
  }, [key, storageKey]);

  if (!key || !open || !storageKey) return null;

  const tour = tours[key];
  const Icon = tour.icon;

  const close = (action: "dismissed" | "started") => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      /* noop */
    }
    void trackFunnelEvent("onboarding_tour_dismissed", { tour: key, action });
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/35 px-4 py-5 backdrop-blur-sm sm:items-center sm:justify-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-use-tour-title"
        className={cn(
          "w-full max-w-lg rounded-[var(--radius-lg)] border bg-card p-5 text-card-foreground shadow-2xl animate-scale-in",
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-kova-blue/10 text-kova-blue">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="first-use-tour-title" className="text-lg font-semibold tracking-tight">
              {tour.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{tour.body}</p>
          </div>
          <button
            type="button"
            onClick={() => close("dismissed")}
            aria-label={copy.tour.dismiss}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          {tour.bullets.map((item) => (
            <div key={item} className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
              {item}
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => close("dismissed")}>
            {copy.tour.skip}
          </Button>
          <Button type="button" onClick={() => close("started")}>
            {tour.cta}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}
