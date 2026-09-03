import type { TemplateVersionRecord } from "../../domain/types";
import type { D1Database, TemplateVersionRepository } from "./contracts";
import { bind, json, parseJson } from "./d1-helpers";

interface TemplateVersionRow {
  id: string;
  flow_id: string;
  version: number;
  subject_template: string;
  body_html: string;
  recipient_configuration_json: string;
  placeholder_manifest_json: string;
  created_at: string;
}

function toTemplateVersion(row: TemplateVersionRow): TemplateVersionRecord {
  return {
    id: row.id,
    flowId: row.flow_id,
    version: row.version,
    subjectTemplate: row.subject_template,
    bodyHtml: row.body_html,
    recipientConfiguration: parseJson(row.recipient_configuration_json, {
      toField: "",
      ccField: null,
      bccField: null,
      replyToField: null,
      separator: "auto" as const,
    }),
    placeholderManifest: parseJson<string[]>(row.placeholder_manifest_json, []),
    createdAt: row.created_at,
  };
}

export class D1TemplateVersionRepository implements TemplateVersionRepository {
  constructor(private readonly db: D1Database) {}

  async getById(id: string): Promise<TemplateVersionRecord | null> {
    const row = await bind(this.db.prepare("SELECT * FROM template_versions WHERE id = ?1"), [id]).first<TemplateVersionRow>();
    return row ? toTemplateVersion(row) : null;
  }

  async listByFlow(flowId: string): Promise<TemplateVersionRecord[]> {
    const result = await bind(
      this.db.prepare("SELECT * FROM template_versions WHERE flow_id = ?1 ORDER BY version DESC"),
      [flowId],
    ).all<TemplateVersionRow>();
    return result.results.map(toTemplateVersion);
  }

  async create(version: TemplateVersionRecord): Promise<void> {
    await bind(
      this.db.prepare(
        `INSERT INTO template_versions
         (id, flow_id, version, subject_template, body_html, recipient_configuration_json, placeholder_manifest_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ),
      [
        version.id,
        version.flowId,
        version.version,
        version.subjectTemplate,
        version.bodyHtml,
        json(version.recipientConfiguration),
        json(version.placeholderManifest),
        version.createdAt,
      ],
    ).run();
  }
}
