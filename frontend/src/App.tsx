import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";
import AuthView from "./auth/AuthView";
import VerifyEmailView from "./auth/VerifyEmailView";
import { useAuth } from "./auth/useAuth";
import BillingView from "./billing/BillingView";
import CatalogView from "./catalog/CatalogView";
import InventoryView from "./inventory/InventoryView";
import OrderDetail from "./orders/OrderDetail";
import OrderListView from "./orders/OrderListView";
import RegisterView from "./register/RegisterView";
import ReportsView from "./reports/ReportsView";
import ShiftView from "./shifts/ShiftView";

function RootRedirect() {
  const { state } = useAuth();
  if (state.status === "loading") return null;
  if (state.status === "authenticated") return <Navigate to="/register" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<AuthView mode="login" />} />
          <Route path="/signup" element={<AuthView mode="signup" />} />
          <Route path="/verify-email" element={<VerifyEmailView />} />

          {/* Root redirect */}
          <Route path="/" element={<RootRedirect />} />

          {/* Protected */}
          <Route
            path="/register"
            element={
              <RequireAuth>
                <RegisterView />
              </RequireAuth>
            }
          />
          <Route
            path="/catalog"
            element={
              <RequireAuth>
                <CatalogView />
              </RequireAuth>
            }
          />
          <Route
            path="/inventory"
            element={
              <RequireAuth>
                <InventoryView />
              </RequireAuth>
            }
          />
          <Route
            path="/orders"
            element={
              <RequireAuth>
                <OrderListView />
              </RequireAuth>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <RequireAuth>
                <OrderDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/reports"
            element={
              <RequireAuth>
                <ReportsView />
              </RequireAuth>
            }
          />
          <Route
            path="/shifts"
            element={
              <RequireAuth>
                <ShiftView />
              </RequireAuth>
            }
          />
          <Route
            path="/settings/billing"
            element={
              <RequireAuth>
                <BillingView />
              </RequireAuth>
            }
          />
          <Route
            path="/settings/billing/:returnState"
            element={
              <RequireAuth>
                <BillingView />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
