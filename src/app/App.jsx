import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppDataProvider } from "./state/api-context";
import { DraftProvider } from "./state/draft-context";
import { RequireProductSession } from "./routing/RequireProductSession";
import { LandingPage } from "./routes/public/LandingPage";
import { CampaignsPage } from "./routes/overview/CampaignsPage";
import { DashboardPage } from "./routes/overview/DashboardPage";
import { FlowsPage } from "./routes/overview/FlowsPage";
import { DataFirstPage } from "./routes/flows/DataFirstPage";
import { EditFlowTemplatePage, TemplatePage } from "./routes/flows/TemplatePage";
import { RecipientsPage } from "./routes/flows/RecipientsPage";
import { ReviewPage } from "./routes/flows/ReviewPage";
import { CampaignPage } from "./routes/campaigns/CampaignPage";

export function App() {
  const protectedRoute = (element) => <RequireProductSession>{element}</RequireProductSession>;
  return <BrowserRouter><AppDataProvider><DraftProvider><Routes><Route path="/" element={<LandingPage />} /><Route path="/dashboard" element={protectedRoute(<DashboardPage />)} /><Route path="/flows" element={protectedRoute(<FlowsPage />)} /><Route path="/flows/new/data" element={protectedRoute(<DataFirstPage />)} /><Route path="/flows/new/template" element={protectedRoute(<TemplatePage />)} /><Route path="/flows/:flowId/edit/template" element={protectedRoute(<EditFlowTemplatePage />)} /><Route path="/flows/new/recipients" element={protectedRoute(<RecipientsPage />)} /><Route path="/flows/new/review" element={protectedRoute(<ReviewPage />)} /><Route path="/campaigns" element={protectedRoute(<CampaignsPage />)} /><Route path="/campaigns/:campaignId" element={protectedRoute(<CampaignPage />)} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></DraftProvider></AppDataProvider></BrowserRouter>;
}
