import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import RequireInternalAdmin from "./RequireInternalAdmin";
import OpsShell from "./OpsShell";

// The whole module is already a lazy chunk (see App.tsx), so pages import
// directly — no second lazy layer needed. NotFound covers unknown sub-paths.
import OverviewPage from "./pages/OverviewPage";
import TenantsPage from "./pages/TenantsPage";
import RevenuePage from "./pages/RevenuePage";
import FunnelPage from "./pages/FunnelPage";
import TechnicalPage from "./pages/TechnicalPage";
import IncidentsPage from "./pages/IncidentsPage";
import IncidentDetailPage from "./pages/IncidentDetailPage";
import TracePage from "./pages/TracePage";

const NotFound = lazy(() => import("@/routes/NotFound"));

export default function InternalOpsRoot() {
  return (
    <RequireInternalAdmin>
      <Routes>
        <Route element={<OpsShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="revenue" element={<RevenuePage />} />
          <Route path="funnel" element={<FunnelPage />} />
          <Route path="technical" element={<TechnicalPage />} />
          <Route path="incidents" element={<IncidentsPage />} />
          <Route path="incidents/:incidentKey" element={<IncidentDetailPage />} />
          <Route path="trace" element={<TracePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </RequireInternalAdmin>
  );
}
