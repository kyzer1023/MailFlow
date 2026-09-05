import type {
  CampaignCounts,
  CampaignRecord,
  FlowRecord,
  TemplateVersionRecord,
  MailImportance,
} from "../../domain/types";
import type {
  CampaignAttachment,
  ClientMapping,
  ClientValidationIssue,
  ClientValidationSummary,
  MappedRecipientRow,
  ParsedSpreadsheet,
  SpreadsheetTable,
} from "../../client/types";
import type { ApiConfig, ApiUser, CampaignResponse } from "../api";
import type { sendCampaignTest } from "../api";

export type AddressRuleMode = "fixed" | "column";

export interface DraftState {
  readonly name: string;
  readonly subject: string;
  readonly cc: string;
  readonly bcc: string;
  readonly replyTo: string;
  readonly body: string;
  readonly fileName: string;
  readonly fileSize: string;
  readonly rowCount: number;
  readonly worksheet: string;
  readonly headerRow: string;
  readonly importance: MailImportance;
  readonly toField: string;
  readonly ccMode: AddressRuleMode;
  readonly bccMode: AddressRuleMode;
  readonly replyToMode: AddressRuleMode;
  readonly ccColumn: string;
  readonly bccColumn: string;
  readonly replyToColumn: string;
  readonly mappings: Readonly<Record<string, string>>;
}

export interface DynamicFieldOption {
  readonly value: string;
  readonly label: string;
}

export interface FlowViewModel {
  readonly id: string;
  readonly name: string;
  readonly fields: readonly string[];
  readonly metaLabel: string;
  readonly status: "draft" | "ready";
}

export type CampaignViewStatus =
  "completed" | "paused" | "running" | "queued" | "failed" | "cancelling" | "cancelled";

export interface CampaignViewModel {
  readonly cancellationNote?: string;
  readonly schedulerMessage?: string | null;
  readonly schedulerNextAttemptAt?: string | null;
  readonly skipped?: number;
  readonly deliveryVerifiedCount?: number;
  readonly id: string;
  readonly name: string;
  readonly date: string;
  readonly updated: string;
  readonly status: CampaignViewStatus;
  readonly accepted: number;
  readonly recipientFailed: number;
  readonly unknown: number;
  readonly notSent: number;
  readonly total: number;
}

export interface DashboardCampaignEntry {
  readonly campaign: Omit<CampaignRecord, "idempotencyKey">;
  readonly counts: CampaignCounts;
  readonly flowName: string;
}

export type SessionStatus =
  "loading" | "authenticated" | "unauthenticated" | "error";

export interface SessionState {
  readonly status: SessionStatus;
  readonly user: ApiUser | null;
  readonly csrfToken: string;
  readonly config: ApiConfig;
  readonly error?: string;
}

export interface ApiContextValue extends SessionState {
  readonly isLive: boolean;
  readonly dashboard: DashboardState;
  readonly refreshDashboard: () => Promise<void>;
  readonly setSession: (
    next: SessionState | ((current: SessionState) => SessionState),
  ) => void;
}

export interface DraftContextValue {
  readonly testRequest: {
    current: Parameters<typeof sendCampaignTest>[1] | null;
  };
  readonly snapshotLocked: boolean;
  readonly lockSnapshot: () => void;
  readonly restartFromMessage: () => void;
  readonly preparation: {
    current: {
      signature: string;
      flowId: string | null;
      response: CampaignResponse | null;
      pending: Promise<CampaignResponse | null> | null;
    } | null;
  };
  readonly draft: DraftState;
  readonly setDraft: (
    next: DraftState | ((current: DraftState) => DraftState),
  ) => void;
  readonly updateDraft: <K extends keyof DraftState>(
    key: K,
    value: DraftState[K],
  ) => void;
  readonly workbook: ParsedSpreadsheet | null;
  readonly setWorkbook: (
    next:
      | ParsedSpreadsheet
      | null
      | ((current: ParsedSpreadsheet | null) => ParsedSpreadsheet | null),
  ) => void;
  readonly table: SpreadsheetTable | null;
  readonly setTable: (
    next:
      | SpreadsheetTable
      | null
      | ((current: SpreadsheetTable | null) => SpreadsheetTable | null),
  ) => void;
  readonly flowId: string | null;
  readonly setFlowId: (
    next: string | null | ((current: string | null) => string | null),
  ) => void;
  readonly campaignResponse: CampaignResponse | null;
  readonly setCampaignResponse: (
    next:
      | CampaignResponse
      | null
      | ((current: CampaignResponse | null) => CampaignResponse | null),
  ) => void;
  readonly campaignRequestKey: string;
  readonly testSendRequestKey: string;
  readonly bodyHtml: string;
  readonly mapping: ClientMapping;
  readonly mappedRows: readonly MappedRecipientRow[];
  readonly validation: ClientValidationSummary | null;
  readonly campaignValidation: ClientValidationSummary | null;
  readonly skipInvalidRows: boolean;
  readonly setSkipInvalidRows: (
    next: boolean | ((current: boolean) => boolean),
  ) => void;
  readonly config: ApiConfig;
  readonly hydrateSavedFlow: (
    flow: FlowRecord,
    templateVersion: TemplateVersionRecord | null,
  ) => void;
  readonly resetWizardState: () => void;
  readonly attachments: readonly CampaignAttachment[];
  readonly setAttachments: (
    next:
      | CampaignAttachment[]
      | ((current: CampaignAttachment[]) => CampaignAttachment[]),
  ) => void;
  readonly attachmentSetId: string | null;
  readonly attachmentSetRequestKey: string;
  readonly attachmentsUploading: boolean;
  readonly attachmentsHaveErrors: boolean;
  readonly attachmentsReady: boolean;
  readonly uploadAttachment: (localId: string, file: File) => Promise<void>;
  readonly retryAttachment: (localId: string) => void;
  readonly removeAttachment: (localId: string) => Promise<void>;
}

export type DashboardStatus = "idle" | "loading" | "ready" | "error";

export interface DashboardState {
  readonly status: DashboardStatus;
  readonly flows: readonly FlowRecord[] | null;
  readonly campaigns: readonly DashboardCampaignEntry[] | null;
  readonly error: string;
}

export interface ValidationIssueAction {
  readonly label: string;
  readonly to: string;
}

export type { ClientValidationIssue };
