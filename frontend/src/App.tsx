import { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import { ToastProvider } from "./components/ui/toast";
import PWAUpdatePrompt from "./components/PWAUpdatePrompt";
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
const OrderDetail = lazy(() => import("./orders/OrderDetail"));
const OrderListView = lazy(() => import("./orders/OrderListView"));
const SyncQueueView = lazy(() => import("./offline/SyncQueueView"));
const RegisterView = lazy(() => import("./register/RegisterView"));
const ReportsView = lazy(() => import("./reports/ReportsView"));
const SettingsView = lazy(() => import("./settings/SettingsView"));
const ShiftView = lazy(() => import("./shifts/ShiftView"));
const AppShell = lazy(() => import("./layout/AppShell"));
const Home = lazy(() => import("./routes/Home"));
const LegalPage = lazy(() => import("./routes/LegalPage"));
const LogoPreview = lazy(() => import("./routes/LogoPreview"));
const ComponentsPreview = lazy(() => import("./routes/ComponentsPreview"));
const IntroPreview = lazy(() => import("./routes/dev/IntroPreview"));
const NotFound = lazy(() => import("./routes/NotFound"));

function RouteFallback() {
  return <div className="min-h-screen bg-[var(--color-bg)]" aria-label="Cargando" />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
                    <RequireAuth>
                      <AppShell />
                    </RequireAuth>
                  }
                >
                  <Route path="/dashboard" element={<DashboardView />} />
                  <Route path="/register" element={<RegisterView />} />
                  <Route path="/catalog" element={<CatalogView />} />
                  <Route path="/inventory" element={<InventoryView />} />
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
                  <Route path="/settings/advanced" element={<SettingsView />} />
                  <Route path="/settings" element={<SettingsView />} />
                  <Route path="/sync-queue" element={<SyncQueueView />} />
                  {/* Spanish slug aliases */}
                  <Route path="/caja" element={<Navigate to="/register" replace />} />
                  <Route path="/ordenes" element={<Navigate to="/orders" replace />} />
                  <Route path="/inventario" element={<Navigate to="/inventory" replace />} />
                  <Route path="/configuracion" element={<Navigate to="/settings" replace />} />
                  <Route path="/reportes" element={<Navigate to="/reports" replace />} />
                  <Route path="/catalogo" element={<Navigate to="/catalog" replace />} />
                  <Route path="/turnos" element={<Navigate to="/shifts" replace />} />
                  <Route path="/panel" element={<Navigate to="/dashboard" replace />} />
                </Route>
                {/* Catch-all 404 (after all real routes) */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
