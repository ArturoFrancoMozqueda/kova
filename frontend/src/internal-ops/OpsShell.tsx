import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LogoMark } from "@/components/brand/Logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { opsCopy } from "./copy";

const NAV = [
  { to: "/internal/ops", label: opsCopy.nav.overview, end: true },
  { to: "/internal/ops/tenants", label: opsCopy.nav.tenants },
  { to: "/internal/ops/revenue", label: opsCopy.nav.revenue },
  { to: "/internal/ops/funnel", label: opsCopy.nav.funnel },
  { to: "/internal/ops/technical", label: opsCopy.nav.technical },
  { to: "/internal/ops/incidents", label: opsCopy.nav.incidents },
  { to: "/internal/ops/trace", label: opsCopy.nav.trace },
];

/**
 * Own shell for the internal dashboard — deliberately NOT the tenant AppShell
 * (no tenant nav / sync queue). A distinct backdrop signals "you're in the
 * internal tool". Kept out of search indexes with a noindex meta tag.
 */
export default function OpsShell() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Kova Ops";
    return () => {
      document.head.removeChild(meta);
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[color:var(--kova-mist)]">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <LogoMark className="h-7 w-7" />
          <span className="font-semibold text-[color:var(--kova-ink)]">{opsCopy.brand}</span>
          <Badge variant="outline">{opsCopy.internalBadge}</Badge>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[color:var(--kova-blue)] text-white"
                    : "text-muted-foreground hover:bg-muted",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
