import { CaretRight } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import type { CampaignViewModel } from "../../state/types";
import { StatusChip } from "../common/StatusChip";
import { completedResult, campaignActivity } from "../../lib/campaign-result";

export interface CampaignTableProps {
  readonly campaigns: readonly CampaignViewModel[];
}

export function CampaignTable({ campaigns }: CampaignTableProps) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Campaign results, scroll horizontally to see all columns">
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Last updated</th>
            <th>Status</th>
            <th>Results</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => {
            const activity = campaignActivity({ ...campaign, state: campaign.status });
            const result = completedResult(campaign.unknown, campaign.recipientFailed, campaign.skipped ?? 0, campaign.deliveryVerifiedCount ?? 0);
            return (
            <tr key={campaign.id}>
              <td>
                <strong>{campaign.name}</strong>
                <small>{campaign.date}</small>
              </td>
              <td>{campaign.updated}</td>
              <td>
                <StatusChip status={campaign.status === "completed" ? result.tone : activity.tone}>
                  {campaign.status === "completed" ? result.label : activity.label}
                </StatusChip>
                {campaign.status === "completed" && campaign.accepted === campaign.total && campaign.total > 0 && <small className="campaign-status-detail">All {campaign.total} emails submitted successfully to Microsoft.</small>}
                {campaign.status !== "completed" && <small className="campaign-status-detail">{activity.detail}</small>}
                {campaign.cancellationNote && <small className="campaign-status-detail">{campaign.cancellationNote}</small>}
              </td>
              <td className="campaign-results">
                <strong>{campaign.accepted}</strong> accepted
                {(campaign.skipped ?? 0) > 0 && <><br /><small>{campaign.skipped} skipped</small></>}
                {campaign.recipientFailed > 0 && (
                  <>
                    <br />
                    <small>{campaign.recipientFailed} recipient failed</small>
                  </>
                )}
                {campaign.unknown > 0 && (
                  <>
                    <br />
                    <small>{campaign.unknown} outcome unknown</small>
                    {(campaign.deliveryVerifiedCount ?? 0) > 0 && <><br /><small>{campaign.deliveryVerifiedCount} delivery verified manually</small></>}
                  </>
                )}
                {["failed", "cancelled", "cancelling"].includes(campaign.status) && (
                  <>
                    <br />
                    <small>{campaign.notSent} not sent</small>
                  </>
                )}
              </td>
              <td>
                <Link
                  className="table-open"
                  to={`/campaigns/${campaign.id}`}
                  aria-label={`Open ${campaign.name}`}
                >
                  <CaretRight />
                </Link>
              </td>
            </tr>
          ); })}
        </tbody>
      </table>
    </div>
  );
}
