import type { Hono } from "hono";
import type { FlowRecord, TemplateVersionRecord } from "../../../domain/types";
import type { MailFlowAppEnv, MailFlowContext } from "../context";
import { repositories } from "../dependencies";
import { TemplatePublicationConflict } from "../../database/d1-template-versions";
import {
  createTemplateVersion,
  id,
  nowIso,
  parseOrError,
  publicFlow,
  requireMutationSession,
  requireSession,
  responseError,
  routeParam,
  versionConfigFromInput,
} from "../helpers";
import {
  flowCreateSchema,
  flowUpdateSchema,
  templateVersionSchema,
} from "../schemas";

/** Register flow CRUD and template-version routes. */
export function registerFlowRoutes(app: Hono<MailFlowAppEnv>): void {
  app.get("/api/flows", async (context) => {
    const authenticated = await requireSession(context);
    if (authenticated instanceof Response) return authenticated;
    const flows = await repositories(context).flows.listByOwner(authenticated.user.id);
    return context.json({ flows: flows.map(publicFlow) });
  });

  app.post("/api/flows", async (context) => {
    const authenticated = await requireMutationSession(context);
    if (authenticated instanceof Response) return authenticated;
    const input = await parseOrError(context, flowCreateSchema);
    if (input instanceof Response) return input;
    if ((input.subjectTemplate === undefined) !== (input.bodyHtml === undefined)) return responseError(context, 422, "invalid_input", "A subject and message body must be provided together.");
    const repo = repositories(context);
    if (await repo.flows.getByNameForOwner(authenticated.user.id, input.name)) {
      return responseError(context, 409, "flow_name_conflict", "Choose a different flow name. Flow names must be unique.");
    }
    const createdAt = nowIso();
    const flow: FlowRecord = {
      id: id("flow"),
      ownerUserId: authenticated.user.id,
      societyName: input.societyName ?? null,
      name: input.name,
      currentTemplateVersionId: null,
      state: "active",
      createdAt,
      updatedAt: createdAt,
    };
    try {
      await repo.flows.create(flow);
    } catch (errorValue) {
      if (await repo.flows.getByNameForOwner(authenticated.user.id, input.name)) {
        return responseError(context, 409, "flow_name_conflict", "Choose a different flow name. Flow names must be unique.");
      }
      throw errorValue;
    }
    let version: TemplateVersionRecord | null = null;
    if (input.subjectTemplate !== undefined && input.bodyHtml !== undefined) {
      version = await createTemplateVersion(repo, flow, {
        subjectTemplate: input.subjectTemplate,
        bodyHtml: input.bodyHtml,
        placeholderManifest: input.placeholderManifest,
        recipientConfiguration: versionConfigFromInput(input.recipientConfiguration ?? { toField: "", separator: "auto" }),
      });
      flow.currentTemplateVersionId = version.id;
      flow.updatedAt = version.createdAt;
    }
    return context.json({ flow: publicFlow(flow), templateVersion: version }, 201);
  });

  app.get("/api/flows/:id", async (context) => {
    const authenticated = await requireSession(context);
    if (authenticated instanceof Response) return authenticated;
    const flow = await repositories(context).flows.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
    if (!flow) return responseError(context, 404, "flow_not_found", "That flow is not available.");
    const templateVersion = flow.currentTemplateVersionId ? await repositories(context).templateVersions.getById(flow.currentTemplateVersionId) : null;
    return context.json({ flow: publicFlow(flow), templateVersion });
  });

  app.patch("/api/flows/:id", updateFlow);
  app.put("/api/flows/:id", updateFlow);

  app.get("/api/flows/:id/versions", async (context) => {
    const authenticated = await requireSession(context);
    if (authenticated instanceof Response) return authenticated;
    const repo = repositories(context);
    const flow = await repo.flows.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
    if (!flow) return responseError(context, 404, "flow_not_found", "That flow is not available.");
    const versions = await repo.templateVersions.listByFlow(flow.id);
    return context.json({ versions });
  });

  app.post("/api/flows/:id/versions", async (context) => {
    const authenticated = await requireMutationSession(context);
    if (authenticated instanceof Response) return authenticated;
    const input = await parseOrError(context, templateVersionSchema);
    if (input instanceof Response) return input;
    const repo = repositories(context);
    const flow = await repo.flows.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
    if (!flow) return responseError(context, 404, "flow_not_found", "That flow is not available.");
    try {
      const version = await createTemplateVersion(repo, flow, {
        ...input,
        recipientConfiguration: versionConfigFromInput(input.recipientConfiguration),
      });
      return context.json({ version }, 201);
    } catch (error) {
      if (error instanceof TemplatePublicationConflict) return responseError(context, 409, "template_changed", error.message);
      if (input.name !== undefined) {
        const sameName = await repo.flows.getByNameForOwner(authenticated.user.id, input.name);
        if (sameName && sameName.id !== flow.id) return responseError(context, 409, "flow_name_conflict", "Choose a different template name. Template names must be unique.");
      }
      const message = "The template could not be saved. Try again shortly.";
      return responseError(context, 422, "invalid_template", message);
    }
  });
}

async function updateFlow(context: MailFlowContext): Promise<Response> {
  const authenticated = await requireMutationSession(context);
  if (authenticated instanceof Response) return authenticated;
  const input = await parseOrError(context, flowUpdateSchema);
  if (input instanceof Response) return input;
  const repo = repositories(context);
  const flow = await repo.flows.getByIdForOwner(routeParam(context, "id"), authenticated.user.id);
  if (!flow) return responseError(context, 404, "flow_not_found", "That flow is not available.");
  if (input.name !== undefined) {
    const sameName = await repo.flows.getByNameForOwner(authenticated.user.id, input.name);
    if (sameName && sameName.id !== flow.id) {
      return responseError(context, 409, "flow_name_conflict", "Choose a different flow name. Flow names must be unique.");
    }
  }
  const updated: FlowRecord = { ...flow, ...(input.name !== undefined ? { name: input.name } : {}), ...(input.societyName !== undefined ? { societyName: input.societyName } : {}), ...(input.state !== undefined ? { state: input.state } : {}), updatedAt: nowIso() };
  try {
    if (!(await repo.flows.update(updated))) return responseError(context, 409, "flow_changed", "The flow changed in another session. Refresh and try again.");
  } catch (errorValue) {
    if (input.name !== undefined) {
      const sameName = await repo.flows.getByNameForOwner(authenticated.user.id, input.name);
      if (sameName && sameName.id !== flow.id) {
        return responseError(context, 409, "flow_name_conflict", "Choose a different flow name. Flow names must be unique.");
      }
    }
    throw errorValue;
  }
  return context.json({ flow: publicFlow(updated) });
}
