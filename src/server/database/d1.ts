import type {
  D1Database,
  Repositories,
} from "./contracts";

import { D1AttachmentRepository } from "./d1-attachments";
import { D1AuditRepository } from "./d1-audit";
import { D1CampaignRepository } from "./d1-campaigns";
import { D1FlowRepository } from "./d1-flows";
import { D1RecipientJobRepository } from "./d1-recipient-jobs";
import { D1TemplateVersionRepository } from "./d1-template-versions";
import { D1UserRepository } from "./d1-users";

export { D1CampaignRepository } from "./d1-campaigns";
export { D1AttachmentRepository } from "./d1-attachments";
export { D1AuditRepository } from "./d1-audit";
export { D1FlowRepository } from "./d1-flows";
export { D1TemplateVersionRepository } from "./d1-template-versions";
export { D1UserRepository } from "./d1-users";
export { D1RecipientJobRepository } from "./d1-recipient-jobs";

export function createD1Repositories(db: D1Database): Repositories {
  return {
    users: new D1UserRepository(db),
    flows: new D1FlowRepository(db),
    templateVersions: new D1TemplateVersionRepository(db),
    campaigns: new D1CampaignRepository(db),
    recipientJobs: new D1RecipientJobRepository(db),
    audit: new D1AuditRepository(db),
    attachments: new D1AttachmentRepository(db),
  };
}
