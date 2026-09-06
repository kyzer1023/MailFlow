import { useEffect, useRef, useState } from "react";
import { getCampaigns } from "../../api";
import { useApi } from "../../state/api-context";
import type { DashboardCampaignEntry } from "../../state/types";
import { displayCampaign } from "../../lib/view-models";
import { AppShell } from "../../components/shell/AppShell";
import { CampaignTable } from "../../components/overview/CampaignTable";

export function CampaignsPage() {
  const { dashboard } = useApi();
  const [older, setOlder] = useState<DashboardCampaignEntry[]>([]);
  const [nextCursor, setNextCursor] = useState(dashboard.nextCampaignCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setOlder([]);
    setNextCursor(dashboard.nextCampaignCursor ?? null);
    setLoading(false);
    setError("");
    return () => { generation.current += 1; };
  }, [dashboard.campaigns, dashboard.nextCampaignCursor]);

  const loadOlder = async () => {
    if (!nextCursor || pending.current) return;
    const currentGeneration = generation.current;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await getCampaigns(nextCursor);
      if (generation.current !== currentGeneration) return;
      const names = new Map(dashboard.flows?.map(flow => [flow.id, flow.name]));
      setOlder(previous => [...previous, ...response.campaigns.map(({ counts, ...campaign }) => ({
        campaign, counts, flowName: names.get(campaign.flowId) || "",
      }))]);
      setNextCursor(response.nextCursor ?? null);
    } catch (failure) {
      if (generation.current === currentGeneration) setError(failure instanceof Error ? failure.message : "Older campaigns could not be loaded.");
    } finally {
      if (generation.current === currentGeneration) { pending.current = false; setLoading(false); }
    }
  };
  const entries = [...(dashboard.campaigns ?? []), ...older];
  const campaigns = [...new Map(entries.map(entry => [entry.campaign.id, displayCampaign(entry.campaign, entry.counts, entry.flowName)])).values()];
  return <AppShell><div className="page library-page">
    <header className="page-header"><div><h1>Campaign history.</h1><p>Every spreadsheet row keeps its own auditable outcome.</p></div></header>
    <section className="panel campaign-list campaign-list--page">
      <div className="section-heading"><h2>All campaigns</h2><span className="empty-link">Newest first</span></div>
      {dashboard.status === "loading" && !dashboard.campaigns ? <p className="empty-state">Loading campaign results...</p>
        : dashboard.status === "error" ? <p className="empty-state">Campaign results could not be loaded. Try again shortly.</p>
        : campaigns.length > 0 ? <CampaignTable campaigns={campaigns} />
        : <div className="empty-state"><h2>No campaigns yet</h2><p>Completed reviews and sends will appear here.</p></div>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {nextCursor && <div className="section-heading"><button className="button button--outline" disabled={loading} aria-busy={loading} onClick={() => void loadOlder()}>
        {loading ? "Loading older campaigns..." : error ? "Retry older campaigns" : "Load older campaigns"}
      </button><span role="status" aria-live="polite">{campaigns.length} campaigns shown</span></div>}
    </section>
  </div></AppShell>;
}
