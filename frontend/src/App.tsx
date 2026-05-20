import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import AuthView from "./auth/AuthView";
import VerifyEmailView from "./auth/VerifyEmailView";
import BillingView from "./billing/BillingView";
import CatalogView from "./catalog/CatalogView";
import DashboardView from "./dashboard/DashboardView";
import InventoryView from "./inventory/InventoryView";
import OrderDetail from "./orders/OrderDetail";
import OrderListView from "./orders/OrderListView";
import SyncQueueView from "./offline/SyncQueueView";
import RegisterView from "./register/RegisterView";
import ReportsView from "./reports/ReportsView";
import SettingsView from "./settings/SettingsView";
import ShiftView from "./shifts/ShiftView";
import AppShell from "./layout/AppShell";
import { ToastProvider } from "./components/ui/toast";
import PWAUpdatePrompt from "./components/PWAUpdatePrompt";
import Home from "./routes/Home";
import LogoPreview from "./routes/LogoPreview";
import ComponentsPreview from "./routes/ComponentsPreview";
import IntroPreview from "./routes/dev/IntroPreview";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <PWAUpdatePrompt />
          <Routes>
            {/* Public */}
            <Route path="/login" element={<AuthView mode="login" />} />
            <Route path="/signup" element={<AuthView mode="signup" />} />
            <Route path="/verify-email" element={<VerifyEmailView />} />

            <Route path="/" element={<Home />} />

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
              <Route path="/settings/billing" element={<BillingView />} />
              <Route path="/settings/billing/:returnState" element={<BillingView />} />
              <Route path="/settings/business-profile" element={<SettingsView />} />
              <Route path="/settings/receipt" element={<SettingsView />} />
              <Route path="/settings/employees" element={<SettingsView />} />
              <Route path="/settings/advanced" element={<SettingsView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="/sync-queue" element={<SyncQueueView />} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
