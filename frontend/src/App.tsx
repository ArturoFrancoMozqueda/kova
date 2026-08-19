import { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import { ToastProvider } from "./components/ui/toast";
import { RouteFallback } from "./components/ui/route-fallback";
import PWAUpdatePrompt from "./components/PWAUpdatePrompt";
import { lazyWithPreload } from "./lib/lazyWithPreload";
import { queryClient } from "./lib/queryClient";

const AuthView = lazy(() => import("./auth/AuthView"));
const ForgotPasswordView = lazy(() => import("./auth/ForgotPasswordView"));
const ResetPasswordView = lazy(() => import("./auth/ResetPasswordView"));
const VerifyEmailView = lazy(() => import("./auth/VerifyEmailView"));
const AcceptInviteView = lazy(() => import("./auth/AcceptInviteView"));
const BillingView = lazy(() => import("./billing/BillingView"));
const CatalogView = lazy(() => import("./catalog/CatalogView"));
const DashboardView = lazy(() => import("./dashboard/DashboardView"));
const InventoryView = lazy(() => import("./inventory/InventoryView"));
const ExpensesView = lazy(() => import("./expenses/ExpensesView"));
const CustomerOrderDetailView = lazy(() => import("./customerOrders/CustomerOrderDetailView"));
const CustomerOrderFormView = lazy(() => import("./customerOrders/CustomerOrderFormView"));
const CustomerOrderListView = lazy(() => import("./customerOrders/CustomerOrderListView"));
const OrderDetail = lazy(() => import("./orders/OrderDetail"));
const OrderListView = lazy(() => import("./orders/OrderListView"));
const SyncQueueView = lazy(() => import("./offline/SyncQueueView"));
const RegisterView = lazy(() => import("./register/RegisterView"));
const ReportsView = lazy(() => import("./reports/ReportsView"));
const SettingsView = lazy(() => import("./settings/SettingsView"));
const ShiftView = lazy(() => import("./shifts/ShiftView"));
const AppShell = lazy(() => import("./layout/AppShell"));
// Prerendered routes use lazyWithPreload: after preload() their first render
// never suspends, which hydrateRoot (main.tsx) and renderToString
// (entry-prerender.tsx) both require to emit/adopt real content instead of the
// Suspense fallback.
const Home = lazyWithPreload(() => import("./routes/Home"));
const LegalPage = lazyWithPreload(() => import("./routes/LegalPage"));
const KovaShowcaseVideo = lazy(() => import("./routes/KovaShowcaseVideo"));
const LogoPreview = lazy(() => import("./routes/LogoPreview"));
const ComponentsPreview = lazy(() => import("./routes/ComponentsPreview"));
const IntroPreview = lazy(() => import("./routes/dev/IntroPreview"));
const InternalOpsRoot = lazy(() => import("./internal-ops/InternalOpsRoot"));
const NotFound = lazy(() => import("./routes/NotFound"));

// Routes that scripts/prerender.mjs writes as static HTML. main.tsx hydrates
// them (after preloading the matching chunk) instead of client-rendering from
// scratch; entry-prerender.tsx awaits the same preload before renderToString.
export const PRERENDERED_ROUTES: Record<string, () => Promise<void>> = {
  "/": () => Home.preload(),
  "/privacy": () => LegalPage.preload(),
  "/terms": () => LegalPage.preload(),
  "/seguridad": () => LegalPage.preload(),
  "/cookies": () => LegalPage.preload(),
};

/**
 * Everything inside the router. Shared verbatim between the client app
 * (BrowserRouter, below) and the build-time prerender (StaticRouter in
 * entry-prerender.tsx) so the server HTML and the hydrating client render the
 * exact same tree — including the Suspense boundary markers.
 */
export function AppRoutes() {
  return (
    <AuthProvider>
      <ToastProvider>
        <PWAUpdatePrompt />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<AuthView mode="login" />} />
            <Route path="/signup" element={<AuthView mode="signup" />} />
            <Route path="/forgot-password" element={<ForgotPasswordView />} />
            <Route path="/reset-password" element={<ResetPasswordView />} />
            <Route path="/verify-email" element={<VerifyEmailView />} />
            <Route path="/accept-invite" element={<AcceptInviteView />} />

            <Route path="/" element={<Home />} />
            {/* Isolated marketing showcase for video export (noindex). */}
            <Route path="/kova-showcase-video" element={<KovaShowcaseVideo />} />
            <Route path="/privacy" element={<LegalPage variant="privacy" />} />
            <Route path="/terms" element={<LegalPage variant="terms" />} />
            <Route path="/seguridad" element={<LegalPage variant="security" />} />
            <Route path="/cookies" element={<LegalPage variant="cookies" />} />

            {import.meta.env.DEV ? (
              <Route path="/dev/logo-preview" element={<LogoPreview />} />
            ) : null}
            {import.meta.env.DEV ? (
              <Route path="/dev/components-preview" element={<ComponentsPreview />} />
            ) : null}
            {import.meta.env.DEV ? (
              <Route path="/dev/intro-preview" element={<IntroPreview />} />
            ) : null}

            {/* Protected */}
            <Route
              element={
                <Suspense fallback={<RouteFallback />}>
                  <RequireAuth>
                    <AppShell />
                  </RequireAuth>
                </Suspense>
              }
            >
              <Route path="/dashboard" element={<DashboardView />} />
              <Route path="/register" element={<RegisterView />} />
              <Route path="/catalog" element={<CatalogView />} />
              <Route path="/inventory" element={<InventoryView />} />
              <Route path="/expenses" element={<ExpensesView />} />
              <Route path="/pedidos" element={<CustomerOrderListView />} />
              <Route path="/pedidos/nuevo" element={<CustomerOrderFormView />} />
              <Route path="/pedidos/:orderId" element={<CustomerOrderDetailView />} />
              <Route path="/pedidos/:orderId/editar" element={<CustomerOrderFormView />} />
              <Route path="/orders" element={<OrderListView />} />
              <Route path="/orders/:orderId" element={<OrderDetail />} />
              <Route path="/reports" element={<ReportsView />} />
              <Route path="/shifts" element={<ShiftView />} />
              <Route path="/billing" element={<Navigate to="/settings/billing" replace />} />
              <Route path="/settings/billing" element={<BillingView />} />
              <Route path="/settings/billing/:returnState" element={<BillingView />} />
              <Route path="/settings/business-profile" element={<SettingsView />} />
              <Route path="/settings/receipt" element={<SettingsView />} />
              <Route path="/settings/employees" element={<SettingsView />} />
              <Route path="/settings/fiscal" element={<SettingsView />} />
              <Route path="/settings/advanced" element={<SettingsView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="/sync-queue" element={<SyncQueueView />} />
              {/* Spanish slug aliases */}
              <Route path="/caja" element={<Navigate to="/register" replace />} />
              <Route path="/ordenes" element={<Navigate to="/orders" replace />} />
              <Route path="/ventas" element={<Navigate to="/orders" replace />} />
              <Route path="/inventario" element={<Navigate to="/inventory" replace />} />
              <Route path="/gastos" element={<Navigate to="/expenses" replace />} />
              <Route path="/configuracion" element={<Navigate to="/settings" replace />} />
              <Route path="/reportes" element={<Navigate to="/reports" replace />} />
              <Route path="/catalogo" element={<Navigate to="/catalog" replace />} />
              <Route path="/turnos" element={<Navigate to="/shifts" replace />} />
              <Route path="/panel" element={<Navigate to="/dashboard" replace />} />
            </Route>

            {/* Private cross-tenant operations area. It intentionally lives
                outside the tenant AppShell; the backend allowlist remains the
                authoritative authorization gate. */}
            <Route path="/internal/ops/*" element={<InternalOpsRoot />} />

            {/* Catch-all 404 (after all real routes) */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
