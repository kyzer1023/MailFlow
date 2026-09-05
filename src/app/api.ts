import { formatSchedulerNotice } from "./lib/format";
import type {
  CampaignCounts,
  CampaignRecord,
  FlowRecord,
  RecipientConfiguration,
  RecipientJobRecord,
  TemplateVersionRecord,
} from "../domain/types";
import type {
  AttachmentFileRecord,
  AttachmentSetRecord,
  CampaignCreatePayload,
} from "../client/types";

export interface ApiUser {
  readonly id: string;
  readonly displayName: string;
  readonly principalName: string;
  readonly mailboxAddress: string;
}

export interface ApiConfig {
  readonly defaultPacePerMinute: number;
  readonly maxCampaignRecipients: number;
  readonly mailTransport?: "graph" | "smtp";
  readonly attachmentsEnabled?: boolean;
  readonly attachmentsReauthorizationRequired?: boolean;
  readonly attachmentsSmtpAuthorizationRequired?: boolean;
  readonly attachmentsOneDriveAuthorizationRequired?: boolean;
  readonly maxAttachmentFiles?: number;
  readonly maxAttachmentBytes?: number;
}

export interface MeResponse {
  readonly user: ApiUser;
  readonly csrfToken: string;
  readonly config: ApiConfig;
}

export interface FlowResponse {
  readonly flow: FlowRecord;
  readonly templateVersion: TemplateVersionRecord | null;
}

export type PublicCampaignRecord = Omit<
  CampaignRecord,
  "idempotencyKey" | "wakeToken" | "wakeDueAt"
>;

export interface CampaignResponse {
  readonly campaign: PublicCampaignRecord;
  readonly counts: CampaignCounts;
}

export interface JobsResponse {
  readonly jobs: readonly RecipientJobRecord[];
  readonly counts: CampaignCounts;
  readonly limit: number;
  readonly offset: number;
}

export interface TestSendResponse {
  readonly replayed?: boolean;
  readonly result: {
    readonly status: "accepted";
    readonly userMessage: "Accepted by Microsoft";
    readonly senderAddress: string;
    readonly recipientAddress: string;
    readonly graphStatus?: number;
    readonly smtpStatus?: number;
    readonly requestId?: string;
  };
}

export interface ApiErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly issues?: readonly {
      code?: string;
      field?: string;
      row?: number;
      message?: string;
    }[];
  };
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: readonly {
    code?: string;
    field?: string;
    row?: number;
    message?: string;
  }[];

  constructor(
    status: number,
    body: ApiErrorBody | null,
    fallback = "Mail Flow could not complete that request.",
  ) {
    super(formatSchedulerNotice(body?.error?.message || fallback));
    this.name = "ApiRequestError";
    this.status = status;
    this.code = body?.error?.code || "request_failed";
    this.issues = body?.error?.issues || [];
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  readonly body?: unknown;
  readonly csrfToken?: string | null;
};

async function readError(response: Response): Promise<ApiErrorBody | null> {
  try {
    const value = (await response.json()) as unknown;
    return value && typeof value === "object" ? (value as ApiErrorBody) : null;
  } catch {
    return null;
  }
}

/** Same-origin API client. Credentials stay in cookies and never enter JSON. */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body !== undefined && !isFormData)
    headers.set("Content-Type", "application/json");
  if (options.csrfToken) headers.set("X-CSRF-Token", options.csrfToken);
  const method = options.method?.toUpperCase() ?? "GET";
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: options.cache ?? (method === "GET" ? "no-store" : undefined),
    headers,
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
  });
  if (!response.ok)
    throw new ApiRequestError(
      response.status,
      await readError(response),
      `Request failed with status ${response.status}.`,
    );
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.toLowerCase().includes("json"))
    return (await response.json()) as T;
  return (await response.text()) as T;
}

export function getMe(): Promise<MeResponse> {
  return apiRequest<MeResponse>("/api/me");
}

export function getFlows(): Promise<{ flows: readonly FlowRecord[] }> {
  return apiRequest<{ flows: readonly FlowRecord[] }>("/api/flows");
}

export function getFlow(flowId: string): Promise<FlowResponse> {
  return apiRequest<FlowResponse>(`/api/flows/${encodeURIComponent(flowId)}`);
}

export function createFlow(
  payload: {
    readonly name: string;
    readonly societyName?: string | null;
    readonly subjectTemplate?: string;
    readonly bodyHtml?: string;
    readonly placeholderManifest?: readonly string[];
    readonly recipientConfiguration?: RecipientConfiguration;
  },
  csrfToken: string,
): Promise<FlowResponse> {
  return apiRequest<FlowResponse>("/api/flows", {
    method: "POST",
    body: payload,
    csrfToken,
  });
}

export function createTemplateVersion(
  flowId: string,
  payload: {
    readonly subjectTemplate: string;
    readonly bodyHtml: string;
    readonly placeholderManifest?: readonly string[];
    readonly recipientConfiguration: RecipientConfiguration;
  },
  csrfToken: string,
): Promise<{ version: TemplateVersionRecord }> {
  return apiRequest<{ version: TemplateVersionRecord }>(
    `/api/flows/${encodeURIComponent(flowId)}/versions`,
    {
      method: "POST",
      body: payload,
      csrfToken,
    },
  );
}

export function archiveFlow(
  flowId: string,
  csrfToken: string,
): Promise<{ flow: FlowRecord }> {
  return apiRequest<{ flow: FlowRecord }>(
    `/api/flows/${encodeURIComponent(flowId)}`,
    {
      method: "PATCH",
      body: { state: "archived" },
      csrfToken,
    },
  );
}

export function updateFlow(
  flowId: string,
  payload: { readonly name: string },
  csrfToken: string,
): Promise<{ flow: FlowRecord }> {
  return apiRequest<{ flow: FlowRecord }>(
    `/api/flows/${encodeURIComponent(flowId)}`,
    {
      method: "PATCH",
      body: payload,
      csrfToken,
    },
  );
}

export function getCampaigns(): Promise<{
  campaigns: readonly (PublicCampaignRecord & { counts: CampaignCounts })[];
}> {
  return apiRequest<{
    campaigns: readonly (PublicCampaignRecord & { counts: CampaignCounts })[];
  }>("/api/campaigns");
}

export function createCampaign(
  payload: CampaignCreatePayload,
  csrfToken: string,
): Promise<CampaignResponse> {
  return apiRequest<CampaignResponse>("/api/campaigns", {
    method: "POST",
    body: payload,
    csrfToken,
  });
}

export interface AttachmentSetResponse {
  readonly attachmentSet: AttachmentSetRecord;
}

export interface AttachmentFileResponse {
  readonly file: AttachmentFileRecord;
  readonly attachmentSet?: AttachmentSetRecord;
}

export function createAttachmentSet(
  idempotencyKey: string,
  csrfToken: string,
): Promise<AttachmentSetResponse> {
  return apiRequest<AttachmentSetResponse>("/api/attachment-sets", {
    method: "POST",
    body: { idempotencyKey },
    csrfToken,
  });
}

export function uploadAttachmentFile(
  setId: string,
  file: File,
  csrfToken: string,
): Promise<AttachmentFileResponse> {
  const body = new FormData();
  body.append("file", file, file.name);
  return apiRequest<AttachmentFileResponse>(
    `/api/attachment-sets/${encodeURIComponent(setId)}/files`,
    {
      method: "POST",
      body,
      csrfToken,
      cache: "no-store",
    },
  );
}

export function deleteAttachmentFile(
  setId: string,
  fileId: string,
  csrfToken: string,
): Promise<void> {
  return apiRequest<void>(
    `/api/attachment-sets/${encodeURIComponent(setId)}/files/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      csrfToken,
    },
  );
}

export function getCampaign(campaignId: string): Promise<CampaignResponse> {
  return apiRequest<CampaignResponse>(
    `/api/campaigns/${encodeURIComponent(campaignId)}`,
  );
}

export function getCampaignJobs(
  campaignId: string,
  limit = 100,
  offset = 0,
): Promise<JobsResponse> {
  return apiRequest<JobsResponse>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/jobs?limit=${limit}&offset=${offset}`,
  );
}

export function sendCampaignTest(
  campaignId: string,
  payload: {
    readonly idempotencyKey: string;
    readonly sourceRow: number;
    readonly subject: string;
    readonly bodyHtml: string;
    readonly cc: readonly string[];
    readonly bcc: readonly string[];
    readonly replyTo: readonly string[];
    readonly importance: "low" | "normal" | "high";
  },
  csrfToken: string,
): Promise<TestSendResponse> {
  return apiRequest<TestSendResponse>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/test-send`,
    { method: "POST", body: payload, csrfToken },
  );
}

export function startCampaign(
  campaignId: string,
  csrfToken: string,
): Promise<{ campaign: CampaignResponse["campaign"] }> {
  return apiRequest<{ campaign: CampaignResponse["campaign"] }>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/start`,
    {
      method: "POST",
      body: { acknowledged: true },
      csrfToken,
    },
  );
}

export function pauseCampaign(
  campaignId: string,
  csrfToken: string,
): Promise<{ campaign: CampaignResponse["campaign"] }> {
  return apiRequest<{ campaign: CampaignResponse["campaign"] }>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/pause`,
    {
      method: "POST",
      body: { reason: "Paused by member" },
      csrfToken,
    },
  );
}

export function verifyDelivery(campaignId: string, jobId: string, note: string, csrfToken: string): Promise<{ job: RecipientJobRecord }> {
  return apiRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/jobs/${encodeURIComponent(jobId)}/delivery-verification`, {
    method: "POST", body: { confirmed: true, note }, csrfToken,
  });
}

export function resumeCampaign(
  campaignId: string,
  csrfToken: string,
): Promise<{ campaign: CampaignResponse["campaign"] }> {
  return apiRequest<{ campaign: CampaignResponse["campaign"] }>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/resume`,
    {
      method: "POST",
      csrfToken,
    },
  );
}

export async function downloadCampaignExport(
  campaignId: string,
): Promise<Blob> {
  const response = await fetch(
    `/api/campaigns/${encodeURIComponent(campaignId)}/export.csv`,
    { credentials: "same-origin", cache: "no-store" },
  );
  if (!response.ok)
    throw new ApiRequestError(
      response.status,
      await readError(response),
      `Request failed with status ${response.status}.`,
    );
  return response.blob();
}

export function logout(csrfToken: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>("/auth/logout", {
    method: "POST",
    csrfToken,
  });
}

export function cancelCampaign(campaignId: string, csrfToken: string): Promise<{ campaign: CampaignResponse["campaign"] }> {
  return apiRequest(`/api/campaigns/${encodeURIComponent(campaignId)}/cancel`, {
    method: "POST", body: { acknowledged: true }, csrfToken,
  });
}
