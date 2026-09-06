import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CampaignRecord,
  FlowRecord,
  RecipientJobRecord,
  TemplateVersionRecord,
} from "../../domain/types";
import type { MailFlowAppEnv } from "./context";
import { registerCampaignCreateRoute } from "./routes/campaign-create";
import { registerFlowRoutes } from "./routes/flows";

const memory = vi.hoisted(() => ({
  flow: null as FlowRecord | null,
  versions: [] as TemplateVersionRecord[],
  campaigns: [] as CampaignRecord[],
  jobs: [] as RecipientJobRecord[],
  updates: 0,
}));
vi.mock("./dependencies", async (original) => ({
  ...(await original<typeof import("./dependencies")>()),
  repositories: () => ({
    flows: {
      getByIdForOwner: async (id: string, owner: string) =>
        memory.flow?.id === id && memory.flow.ownerUserId === owner
          ? memory.flow
          : null,
      update: async (flow: FlowRecord) => {
        memory.flow = flow;
        memory.updates += 1;
      },
    },
    templateVersions: {
      getById: async (id: string) =>
        memory.versions.find((version) => version.id === id) || null,
      listByFlow: async () =>
        [...memory.versions].sort((a, b) => b.version - a.version),
      create: async (input: Omit<TemplateVersionRecord, "version">, publication?: { ownerUserId: string; expectedVersionId: string | null }) => {
        const version = { ...input, version: memory.versions.length + 1 };
        memory.versions.push(version);
        if (publication && memory.flow) { memory.flow.currentTemplateVersionId = version.id; memory.updates += 1; }
        return version;
      },
    },
    campaigns: {
      getByIdempotencyKey: async (owner: string, key: string) =>
        memory.campaigns.find(
          (campaign) =>
            campaign.ownerUserId === owner && campaign.idempotencyKey === key,
        ) || null,
      create: async (campaign: CampaignRecord, jobs: RecipientJobRecord[]) => {
        memory.campaigns.push(campaign);
        memory.jobs.push(...jobs);
      },
    },
    attachments: { getSetByCampaignId: async () => null },
    recipientJobs: {
      counts: async () => ({
        pending: 1,
        claimed: 0,
        sending: 0,
        accepted: 0,
        failed: 0,
        skipped: 0,
        unknown: 0,
      }),
    },
  }),
}));
vi.mock("./helpers", async (original) => ({
  ...(await original<typeof import("./helpers")>()),
  requireMutationSession: async () => ({
    user: { id: "owner", mailboxAddress: "member@student.example" },
  }),
}));
const configuration = {
  toField: "email",
  ccField: null,
  bccField: null,
  replyToField: null,
  ccFixed: null,
  bccFixed: null,
  replyToFixed: null,
  placeholderMappings: {},
  separator: "auto" as const,
  importance: "normal" as const,
};
const campaignInput = () => ({
  flowId: "flow",
  templateVersionId: null,
  subjectTemplate: "For this send",
  bodyHtml: "<p>Current message</p>",
  recipientConfiguration: configuration,
  totalRecipients: 1,
  validRecipients: 1,
  skippedRecipients: 0,
  idempotencyKey: "reviewed-request",
  rows: [
    {
      sourceRow: 2,
      to: "recipient@example.test",
      cc: [],
      bcc: [],
      replyTo: [],
      mergeData: {},
      renderedSubject: "For this send",
      renderedBodyHtml: "<p>Current message</p>",
    },
  ],
});
function app() {
  const instance = new Hono<MailFlowAppEnv>();
  registerFlowRoutes(instance);
  registerCampaignCreateRoute(instance);
  return instance;
}
beforeEach(() => {
  memory.flow = {
    id: "flow",
    ownerUserId: "owner",
    name: "Saved template",
    societyName: null,
    state: "active",
    currentTemplateVersionId: "original",
    createdAt: "2026-09-05",
    updatedAt: "2026-09-05",
  };
  memory.versions = [
    {
      id: "original",
      flowId: "flow",
      version: 1,
      subjectTemplate: "Original",
      bodyHtml: "<p>Original</p>",
      recipientConfiguration: configuration,
      placeholderManifest: [],
      createdAt: "2026-09-05",
    },
  ];
  memory.campaigns = [];
  memory.jobs = [];
  memory.updates = 0;
});
describe("explicit template publication", () => {
  it("prepares and replays a send without replacing the reusable template", async () => {
    const instance = app();
    const post = () =>
      instance.request(
        "https://example.test/api/campaigns",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(campaignInput()),
        },
        {},
      );
    expect((await post()).status).toBe(201);
    expect(memory.flow?.currentTemplateVersionId).toBe("original");
    expect(memory.updates).toBe(0);
    expect(memory.versions).toHaveLength(2);
    expect(memory.jobs[0].renderedBodyHtml).toBe("<p>Current message</p>");
    expect((await post()).status).toBe(200);
    expect(memory.campaigns).toHaveLength(1);
    expect(memory.versions).toHaveLength(2);
  });
  it("advances the reusable template only through explicit version saving", async () => {
    const response = await app().request(
      "https://example.test/api/flows/flow/versions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectTemplate: "New saved message",
          bodyHtml: "<p>Reusable</p>",
          recipientConfiguration: configuration,
        }),
      },
      {},
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { version: TemplateVersionRecord };
    expect(memory.flow?.currentTemplateVersionId).toBe(body.version.id);
    expect(memory.updates).toBe(1);
    expect(memory.campaigns).toHaveLength(0);
  });
});
