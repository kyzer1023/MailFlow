export type FlowStatus = "ready" | "draft";

export type CampaignStatus = "completed" | "paused" | "running" | "queued";

export type JobStatus = "pending" | "sending" | "accepted" | "failed" | "skipped" | "unknown";

export type DataRow = {
  row: number;
  name: string;
  email: string;
  project: string;
  eventDate: string;
  deadline: string;
};

export type FlowFixture = {
  id: string;
  name: string;
  fields: string[];
  metaLabel: string;
  status: FlowStatus;
};

export type CampaignFixture = {
  id: string;
  name: string;
  date: string;
  updated: string;
  status: CampaignStatus;
  accepted: number;
  failed: number;
  sent: number;
  total: number;
};

export type JobFixture = {
  recipient: string;
  row: number;
  status: JobStatus;
  attempts: number;
  update: string;
  note: string;
};

export const memberFixture = {
  firstName: "Alex",
  name: "Alex Tan",
  email: "student@example.com",
  society: "USM Debate Society",
  role: "Admin",
} as const;

export const flowFixtures: FlowFixture[] = [
  {
    id: "pixel-judges",
    name: "PIXEL Judge Invitation",
    fields: ["{{judge_name}}", "{{project_title}}"],
    metaLabel: "Last used 28 Aug",
    status: "ready",
  },
  {
    id: "certificate-distribution",
    name: "Certificate Distribution",
    fields: ["{{recipient_name}}", "{{certificate_link}}"],
    metaLabel: "Last edited 26 Aug",
    status: "draft",
  },
];

export const campaignFixtures: CampaignFixture[] = [
  {
    id: "CMP-2026-08-31-DEMO",
    name: "PIXEL Judges",
    date: "31 Aug 2026",
    updated: "31 Aug, 10:32 AM",
    status: "completed",
    accepted: 142,
    failed: 2,
    sent: 144,
    total: 144,
  },
  {
    id: "CMP-2026-08-21-WORKSHOP",
    name: "Workshop reminder",
    date: "21 Aug 2026",
    updated: "21 Aug, 09:15 AM",
    status: "completed",
    accepted: 86,
    failed: 0,
    sent: 86,
    total: 86,
  },
  {
    id: "CMP-2026-08-14-VOLUNTEER",
    name: "Volunteer onboarding",
    date: "14 Aug 2026",
    updated: "14 Aug, 04:45 PM",
    status: "paused",
    accepted: 43,
    failed: 0,
    sent: 43,
    total: 90,
  },
];

export const dataRows: DataRow[] = [
  { row: 1, name: "Alex Tan", email: "alex@example.com", project: "PIXEL Debate 2026", eventDate: "2026-08-15", deadline: "2026-07-31" },
  { row: 2, name: "Jordan Lee", email: "jordan@example.com", project: "PIXEL Debate 2026", eventDate: "2026-08-15", deadline: "2026-07-31" },
  { row: 3, name: "Sam Lee", email: "sam@example.com", project: "PIXEL Debate 2026", eventDate: "2026-08-15", deadline: "2026-07-31" },
  { row: 87, name: "Taylor Noor", email: "invalid@", project: "PIXEL Debate 2026", eventDate: "2026-08-15", deadline: "2026-07-31" },
  { row: 88, name: "Morgan Ali", email: "morgan@example.com", project: "PIXEL Debate 2026", eventDate: "2026-08-15", deadline: "2026-07-31" },
];

export const columnFixtures = ["Judge Name", "Email", "Project Title", "Event Date", "Reply Deadline"] as const;

export const placeholderFixtures = ["judge_name", "judge_email", "project_title", "event_date", "reply_deadline"] as const;

export type PlaceholderKey = (typeof placeholderFixtures)[number];

export const jobFixtures: JobFixture[] = [
  { recipient: "Alex Tan", row: 1, status: "accepted", attempts: 1, update: "10:42:12", note: "Request accepted" },
  { recipient: "Jordan Lee", row: 2, status: "accepted", attempts: 1, update: "10:42:17", note: "Request accepted" },
  { recipient: "Sam Lee", row: 3, status: "sending", attempts: 1, update: "10:42:22", note: "Waiting for Microsoft" },
  { recipient: "Taylor Noor", row: 87, status: "skipped", attempts: 0, update: "Not available", note: "Invalid email address" },
  { recipient: "Morgan Ali", row: 88, status: "pending", attempts: 0, update: "Not available", note: "Queued" },
];

export const bodyTemplate = `Hello {{judge_name}},

You are invited to be a judge for PIXEL, a celebration of purposeful ideas and impactful solutions by university students.

The event will take place on {{event_date}}, and your evaluation will help us recognise the strongest work and provide meaningful feedback.

Please review the submissions at your convenience and share your feedback by {{reply_deadline}}.

Thank you for supporting excellence and advancing the next generation of leaders.\nWe truly appreciate your time and expertise.

Warm regards,
USM Debate Society`;

export const initialDraft = {
  name: "PIXEL Judge Invitation",
  subject: "Invitation to evaluate {{project_title}}",
  cc: "events@example.org",
  bcc: "",
  replyTo: "",
  body: bodyTemplate,
  fileName: "recipients.xlsx",
  fileSize: "312 KB",
  rowCount: 148,
  worksheet: "Judges",
  headerRow: "Row 1",
  pace: 12,
  mappings: {
    judge_name: "Judge Name",
    judge_email: "Email",
    project_title: "Project Title",
    event_date: "Event Date",
    reply_deadline: "Reply Deadline",
  },
} as const;

export type Draft = {
  name: string;
  subject: string;
  cc: string;
  bcc: string;
  replyTo: string;
  body: string;
  fileName: string;
  fileSize: string;
  rowCount: number;
  worksheet: string;
  headerRow: string;
  pace: number;
  mappings: Record<PlaceholderKey, string>;
};
