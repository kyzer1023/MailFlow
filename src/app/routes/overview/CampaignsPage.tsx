import { useApi } from "../../state/api-context";
import { displayCampaign } from "../../lib/view-models";
import { AppShell } from "../../components/shell/AppShell";
import { CampaignTable } from "../../components/overview/CampaignTable";

export function CampaignsPage() {
  const { dashboard } = useApi();
  const campaigns = dashboard.campaigns ? dashboard.campaigns.map((entry) => displayCampaign(entry.campaign, entry.counts, entry.flowName)) : [];
  return <AppShell><div className="page library-page"><header className="page-header"><div><h1>Campaign history.</h1><p>Every spreadsheet row keeps its own auditable outcome.</p></div></header><section className="panel campaign-list campaign-list--page"><div className="section-heading"><h2>All campaigns</h2><span className="empty-link">Newest first</span></div>{dashboard.status === "loading" && !dashboard.campaigns ? <p className="empty-state">Loading campaign results...</p> : dashboard.status === "error" ? <p className="empty-state">Campaign results could not be loaded. Try again shortly.</p> : campaigns.length > 0 ? <CampaignTable campaigns={campaigns} /> : <div className="empty-state"><h2>No campaigns yet</h2><p>Completed reviews and sends will appear here.</p></div>}</section></div></AppShell>;
}
