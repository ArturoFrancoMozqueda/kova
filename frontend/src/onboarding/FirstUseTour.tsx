import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowRight, LayoutGrid, ShoppingCart, X } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { listProducts } from "@/catalog/api";
import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { MOTION_MS } from "@/lib/motion";
import { usePresence } from "@/lib/usePresence";
import { trackFunnelEvent } from "@/telemetry/funnel";

type TourKey = "register" | "catalog";

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
};

function tourKey(pathname: string): TourKey | null {
  if (pathname === "/register") return "register";
  if (pathname === "/catalog") return "catalog";
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
  const presence = usePresence(Boolean(key && open && storageKey), MOTION_MS.modalExit);

  useEffect(() => {
    let cancelled = false;

    async function decideVisibility() {
      if (!storageKey || !key) {
        setOpen(false);
        return;
      }

      try {
        const seen = window.localStorage.getItem(storageKey);
        if (seen) {
          setOpen(false);
          return;
        }

        if (key === "catalog") {
          const products = await listProducts().catch(() => []);
          if (products.some((product) => product.is_active)) {
            if (!cancelled) setOpen(false);
            return;
          }
        }

        if (!cancelled) {
          setOpen(true);
          void trackFunnelEvent("onboarding_tour_viewed", { tour: key });
        }
      } catch {
        if (!cancelled) setOpen(false);
      }
    }

    void decideVisibility();

    return () => {
      cancelled = true;
    };
  }, [key, storageKey]);

  if (!key || !storageKey || !presence.mounted) return null;

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
    <div
      data-testid="first-use-tour"
      className="pointer-events-none fixed inset-x-0 bottom-16 z-[80] flex justify-center px-4 py-3 sm:bottom-5 sm:left-5 sm:right-auto sm:block sm:w-[380px] sm:max-w-[calc(100vw-2rem)] lg:left-[280px]"
    >
      <section
        aria-labelledby="first-use-tour-title"
        {...(presence.exiting
          ? ({ "aria-hidden": true, inert: "" } as React.HTMLAttributes<HTMLElement>)
          : {})}
        className={cn(
          "pointer-events-auto w-full rounded-[var(--radius-lg)] border bg-card p-4 text-card-foreground shadow-2xl sm:p-5",
          presence.exiting ? "pointer-events-none animate-scale-out" : "animate-scale-in",
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
        <div className="mt-4 hidden gap-2 sm:grid">
          {tour.bullets.map((item) => (
            <div key={item} className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
              {item}
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2 sm:mt-5 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => close("dismissed")} className="flex-1 sm:flex-none">
            {copy.tour.skip}
          </Button>
          <Button type="button" onClick={() => close("started")} className="flex-1 sm:flex-none">
            {tour.cta}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}
