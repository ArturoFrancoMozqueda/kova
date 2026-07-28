import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { StaticRouter } from "react-router-dom/server";
import { AppRoutes, PRERENDERED_ROUTES } from "./App";
import { queryClient } from "./lib/queryClient";

// Re-exported so scripts/prerender.mjs can derive the landing JSON-LD (FAQ +
// Offer) from the same copy and billing constants the page renders with.
export { LANDING_SEO } from "./seo/landingSeo";

// Build-time prerender entry. Renders the public, content-bearing routes to
// static HTML so crawlers and link unfurlers see real content instead of an
// empty SPA shell. This file is built separately (vite.config.ssr.ts) and is
// NEVER part of the client bundle.
//
// It renders the SAME AppRoutes tree the client hydrates (main.tsx), so the
// prerendered HTML — Suspense boundary markers included — matches what
// hydrateRoot expects. The route component is preloaded first because a
// suspended lazy route would make renderToString emit the fallback spinner
// instead of the page.
export async function render(url: string): Promise<string> {
  const preload = PRERENDERED_ROUTES[url];
  if (!preload) {
    throw new Error(`entry-prerender: "${url}" is not a prerendered route`);
  }
  await preload();
  return renderToString(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <StaticRouter location={url}>
          <AppRoutes />
        </StaticRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
