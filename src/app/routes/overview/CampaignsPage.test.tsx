import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DashboardState } from "../../state/types";
import type { PublicCampaignRecord } from "../../api";
import { CampaignsPage } from "./CampaignsPage";

const mocks = vi.hoisted(() => ({ dashboard: {} as DashboardState, get: vi.fn() }));
vi.mock("../../api", () => ({ getCampaigns: mocks.get }));
vi.mock("../../state/api-context", () => ({ useApi: () => ({ dashboard: mocks.dashboard }) }));
vi.mock("../../components/shell/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }));
const counts = { pending: 0, claimed: 0, sending: 0, accepted: 1, failed: 0, skipped: 0, unknown: 0 };
const campaign = (id: string) => ({ id, flowId: "flow", sourceFilename: `${id}.csv`, state: "completed", totalRecipients: 1,
  createdAt: "2026-09-06T00:00:00.000Z", completedAt: "2026-09-06T00:01:00.000Z" } as PublicCampaignRecord);
beforeEach(() => {
  mocks.get.mockReset();
  mocks.dashboard = { status: "ready", error: "", flows: [], campaigns: [{ campaign: campaign("newest"), counts, flowName: "" }], nextCampaignCursor: "cursor-1" };
});
afterEach(cleanup);
const view = () => <MemoryRouter><CampaignsPage /></MemoryRouter>;

it("keeps existing history during an older-page failure and retries the same cursor", async () => {
  mocks.get.mockRejectedValueOnce(new Error("Temporary history failure")).mockResolvedValueOnce({ campaigns: [{ ...campaign("older"), counts }], nextCursor: null });
  render(view());
  fireEvent.click(screen.getByRole("button", { name: "Load older campaigns" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Temporary history failure");
  expect(screen.getByRole("link", { name: "newest.csv" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry older campaigns" }));
  expect(await screen.findByRole("link", { name: "older.csv" })).toBeInTheDocument();
  expect(mocks.get.mock.calls).toEqual([["cursor-1"], ["cursor-1"]]);
  expect(screen.queryByRole("button", { name: /older campaigns/i })).not.toBeInTheDocument();
});

it("discards an obsolete response when the first page refreshes", async () => {
  let resolve!: (value: unknown) => void;
  mocks.get.mockReturnValue(new Promise(done => { resolve = done; }));
  const mounted = render(view());
  fireEvent.click(screen.getByRole("button", { name: "Load older campaigns" }));
  expect(screen.getByRole("button", { name: "Loading older campaigns..." })).toBeDisabled();
  mocks.dashboard = { ...mocks.dashboard, campaigns: [{ campaign: campaign("refreshed"), counts, flowName: "" }], nextCampaignCursor: "cursor-2" };
  mounted.rerender(view());
  await act(async () => resolve({ campaigns: [{ ...campaign("obsolete"), counts }], nextCursor: null }));
  expect(screen.queryByRole("link", { name: "obsolete.csv" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "refreshed.csv" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Load older campaigns" })).toBeEnabled();
});
