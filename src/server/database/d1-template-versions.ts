import type { TemplateVersionRecord } from "../../domain/types";
import type { D1Database, D1PreparedStatement, TemplateVersionRepository } from "./contracts";
import { bind, json, parseJson } from "./d1-helpers";

export class TemplatePublicationConflict extends Error {
  constructor() { super("This template changed in another session. Reload it or save as a new template."); }
}

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

  async create(version: Omit<TemplateVersionRecord, "version">, publication?: {
    ownerUserId: string; expectedVersionId: string | null; name?: string;
  }): Promise<TemplateVersionRecord> {
    const insert = bind(
      this.db.prepare(
        `INSERT INTO template_versions
         (id, flow_id, version, subject_template, body_html, recipient_configuration_json, placeholder_manifest_json, created_at)
         SELECT ?1, ?2, COALESCE(MAX(version), 0) + 1, ?3, ?4, ?5, ?6, ?7
         FROM template_versions WHERE flow_id = ?2`,
      ),
      [
        version.id,
        version.flowId,
        version.subjectTemplate,
        version.bodyHtml,
        json(version.recipientConfiguration),
        json(version.placeholderManifest),
        version.createdAt,
      ],
    );
    const statements: D1PreparedStatement[] = [insert];
    if (publication) {
      statements.push(bind(this.db.prepare(`UPDATE flows
        SET current_template_version_id = ?1, updated_at = ?2, name = COALESCE(?3, name)
        WHERE id = ?4 AND owner_user_id = ?5 AND state = 'active' AND current_template_version_id IS ?6`),
      [version.id, version.createdAt, publication.name ?? null, version.flowId, publication.ownerUserId, publication.expectedVersionId]),
      this.db.prepare("INSERT INTO mailbox_coordination_guard(singleton) SELECT 1 WHERE changes() != 1"));
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (publication && error instanceof Error && /mailbox_coordination_guard/iu.test(error.message)) throw new TemplatePublicationConflict();
      throw error;
    }
    const saved = await this.getById(version.id);
    if (!saved) throw new Error("Template persistence could not be confirmed");
    return saved;
  }
}
