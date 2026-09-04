import { isValidEmail } from "../../domain/validation";
import { z } from "zod";
import { MAX_RECIPIENT_SNAPSHOT_BYTES } from "../../domain/campaign-limits";

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const mailbox = nonEmpty(320).refine(isValidEmail, "Enter one valid email address.");
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalRecipientField = (max: number) => z.string().trim().max(max).nullable().optional().default(null);
const optionalAddressText = (max: number) => z.string().trim().max(max).nullable().optional().default(null);
const boundedMappings = z.record(nonEmpty(160), nonEmpty(160)).superRefine((value, context) => {
  if (Object.keys(value).length > 100) context.addIssue({ code: "custom", message: "Too many spreadsheet field mappings were provided." });
});
const placeholderMappings = boundedMappings.optional().default({});

export const recipientConfigurationSchema = z.object({
  toField: nonEmpty(160),
  ccField: optionalRecipientField(160),
  bccField: optionalRecipientField(160),
  replyToField: optionalRecipientField(160),
  ccFixed: optionalAddressText(20_000),
  bccFixed: optionalAddressText(20_000),
  replyToFixed: optionalAddressText(20_000),
  placeholderMappings,
  importance: z.enum(["low", "normal", "high"]).default("normal"),
  separator: z.enum(["comma", "semicolon", "newline", "auto"]).default("auto"),
}).strict();

const mergeDataSchema = z.record(z.string().trim().min(1).max(160), z.string().max(20_000)).superRefine((value, context) => {
  if (Object.keys(value).length > 100) context.addIssue({ code: "custom", message: "A row contains too many mapped fields." });
});

export const campaignRecipientSchema = z.object({
  sourceRow: z.number().int().min(1).max(1_000_000),
  to: mailbox,
  cc: z.array(mailbox).max(50).default([]),
  bcc: z.array(mailbox).max(50).default([]),
  replyTo: z.array(mailbox).max(50).default([]),
  mergeData: mergeDataSchema.default({}),
  renderedSubject: nonEmpty(998),
  renderedBodyHtml: nonEmpty(200_000),
}).strict().superRefine((value, context) => {
  // D1 bulk insertion wraps the JSON columns as strings inside a bound JSON
  // tuple. Measure that representation and retain headroom for generated IDs,
  // state fields, and timestamps that the Worker adds after validation.
  const persistenceBytes = new TextEncoder().encode(JSON.stringify([
    value.sourceRow,
    value.to,
    JSON.stringify(value.cc),
    JSON.stringify(value.bcc),
    JSON.stringify(value.replyTo),
    JSON.stringify(value.mergeData),
    value.renderedSubject,
    value.renderedBodyHtml,
  ])).byteLength;
  if (persistenceBytes > MAX_RECIPIENT_SNAPSHOT_BYTES - 2_048) {
    context.addIssue({ code: "custom", message: "A recipient snapshot is too large to store safely." });
  }
});

export const campaignCreateSchema = z.object({
  flowId: nonEmpty(128),
  attachmentSetId: z.string().trim().max(128).nullable().optional().default(null),
  templateVersionId: z.string().trim().max(128).nullable().optional(),
  sourceFilename: z.string().trim().max(255).nullable().optional(),
  subjectTemplate: nonEmpty(998),
  bodyHtml: nonEmpty(200_000),
  placeholderManifest: z.array(nonEmpty(160)).max(100).default([]),
  placeholderMappings: boundedMappings.optional(),
  recipientConfiguration: recipientConfigurationSchema,
  pacePerMinute: z.number().int().min(1).max(600).optional(),
  totalRecipients: z.number().int().min(0).max(300),
  validRecipients: z.number().int().min(0).max(300),
  skippedRecipients: z.number().int().min(0).max(300),
  rows: z.array(campaignRecipientSchema).max(300),
  idempotencyKey: z.string().trim().min(1).max(160),
}).strict();

export const flowCreateSchema = z.object({
  name: nonEmpty(120),
  societyName: optionalText(160),
  subjectTemplate: z.string().trim().max(998).optional(),
  bodyHtml: z.string().trim().max(200_000).optional(),
  placeholderManifest: z.array(nonEmpty(160)).max(100).optional(),
  recipientConfiguration: recipientConfigurationSchema.optional(),
}).strict();

export const flowUpdateSchema = z.object({
  name: nonEmpty(120).optional(),
  societyName: optionalText(160),
  state: z.enum(["active", "archived"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one flow field is required." });

export const templateVersionSchema = z.object({
  subjectTemplate: nonEmpty(998),
  bodyHtml: nonEmpty(200_000),
  placeholderManifest: z.array(nonEmpty(160)).max(100).optional(),
  recipientConfiguration: recipientConfigurationSchema,
}).strict();

export const testSendSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(160),
  sourceRow: z.number().int().min(1).max(1_000_000),
  subject: nonEmpty(998),
  bodyHtml: nonEmpty(200_000),
  cc: z.array(mailbox).max(50).default([]),
  bcc: z.array(mailbox).max(50).default([]),
  replyTo: z.array(mailbox).max(50).default([]),
  importance: z.enum(["low", "normal", "high"]).default("normal"),
}).strict();

export const acknowledgementSchema = z.object({
  acknowledged: z.literal(true),
}).strict();

export const attachmentSetCreateSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();

export const pauseSchema = z.object({
  reason: z.string().trim().max(240).optional(),
}).strict();

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;
export type FlowCreateInput = z.infer<typeof flowCreateSchema>;
export type TemplateVersionInput = z.infer<typeof templateVersionSchema>;

export function validationIssues(error: z.ZodError): readonly { code: string; field?: string; message: string }[] {
  return error.issues.slice(0, 50).map((issue) => ({
    code: issue.code,
    field: issue.path.length > 0 ? issue.path.join(".") : undefined,
    message: issue.message,
  }));
}
