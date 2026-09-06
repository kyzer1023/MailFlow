import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppDataProvider } from "./state/api-context";
import { RouteBoundary } from "./routing/RouteBoundary";
import { RequireProductSession } from "./routing/RequireProductSession";
import { LandingPage } from "./routes/public/LandingPage";
const ProductLayout = lazy(() => import("./routing/ProductLayout"));
const CampaignsPage = lazy(() =>
  import("./routes/overview/CampaignsPage").then((module) => ({
    default: module.CampaignsPage,
  })),
);
const DashboardPage = lazy(() =>
  import("./routes/overview/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const FlowsPage = lazy(() =>
  import("./routes/overview/FlowsPage").then((module) => ({
    default: module.FlowsPage,
  })),
);
const DataFirstPage = lazy(() =>
  import("./routes/flows/DataFirstPage").then((module) => ({
    default: module.DataFirstPage,
  })),
);
const TemplatePage = lazy(() =>
  import("./routes/flows/TemplatePage").then((module) => ({
    default: module.TemplatePage,
  })),
);
const EditFlowTemplatePage = lazy(() =>
  import("./routes/flows/TemplatePage").then((module) => ({
    default: module.EditFlowTemplatePage,
  })),
);
const ReviewPage = lazy(() =>
  import("./routes/flows/ReviewPage").then((module) => ({
    default: module.ReviewPage,
  })),
);
const CampaignPage = lazy(() =>
  import("./routes/campaigns/CampaignPage").then((module) => ({
    default: module.CampaignPage,
  })),
);

export function App() {
  return (
    <BrowserRouter>
      <AppDataProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            element={
              <RequireProductSession>
                <RouteBoundary>
                  <ProductLayout />
                </RouteBoundary>
              </RequireProductSession>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/flows" element={<FlowsPage />} />
            <Route path="/flows/new/data" element={<DataFirstPage />} />
            <Route
              path="/flows/new/saved-template"
              element={<TemplatePage standalone />}
            />
            <Route path="/flows/new/template" element={<TemplatePage />} />
            <Route
              path="/flows/:flowId/edit/template"
              element={<EditFlowTemplatePage />}
            />
            <Route
              path="/flows/new/recipients"
              element={<Navigate to="/flows/new/template" replace />}
            />
            <Route path="/flows/new/review" element={<ReviewPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaigns/:campaignId" element={<CampaignPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppDataProvider>
    </BrowserRouter>
  );
}
