import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { StaticRouter } from "react-router-dom/server";
import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/ui/toast";
import { queryClient } from "./lib/queryClient";
import Home from "./routes/Home";
import LegalPage from "./routes/LegalPage";

// Build-time prerender entry. Renders the public, content-bearing routes to
// static HTML so crawlers and link unfurlers see real content instead of an
// empty SPA shell. This file is built separately (vite.config.ssr.ts) and is
// NEVER part of the client bundle.
//
// IMPORTANT: these routes must mirror the public marketing/legal routes in
// App.tsx (lines ~55-59). Routes are imported eagerly (no React.lazy) because
// renderToString would otherwise emit each route's Suspense fallback instead
// of its content. Keep the two lists in sync.
export function render(url: string): string {
  return renderToString(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <StaticRouter location={url}>
          <AuthProvider>
            <ToastProvider>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/privacy" element={<LegalPage variant="privacy" />} />
                <Route path="/terms" element={<LegalPage variant="terms" />} />
                <Route path="/seguridad" element={<LegalPage variant="security" />} />
                <Route path="/cookies" element={<LegalPage variant="cookies" />} />
              </Routes>
            </ToastProvider>
          </AuthProvider>
        </StaticRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
