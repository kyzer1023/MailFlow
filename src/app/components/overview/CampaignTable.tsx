import { CaretRight } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import type { CampaignViewModel } from "../../state/types";
import { StatusChip } from "../common/StatusChip";

export interface CampaignTableProps {
  readonly campaigns: readonly CampaignViewModel[];
}

export function CampaignTable({ campaigns }: CampaignTableProps) {
  return <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Last updated</th><th>Status</th><th>Results</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong><small>{campaign.date}</small></td><td>{campaign.updated}</td><td><StatusChip status={campaign.status}>{campaign.status[0].toUpperCase() + campaign.status.slice(1)}</StatusChip></td><td><strong>{campaign.accepted}</strong> accepted<br /><small>{campaign.failed} failed</small></td><td><Link className="table-open" to={`/campaigns/${campaign.id}`} aria-label={`Open ${campaign.name}`}><CaretRight /></Link></td></tr>)}</tbody></table></div>;
}
