import type { Hono } from "hono";
import {
  ATTACHMENT_MAX_BYTES,
} from "../../attachments";
import type { MailFlowAppEnv } from "../context";
import {
  attachmentInfrastructureAvailable,
  attachmentServiceFor,
  oneDriveAuthorizedFor,
  repositories,
  smtpAuthorizedFor,
} from "../dependencies";
import {
  attachmentErrorResponse,
  parseOrError,
  requireMutationSession,
  responseError,
  routeParam,
} from "../helpers";
import { publicAttachmentFile, publicAttachmentSet } from "../attachments";
import { attachmentSetCreateSchema } from "../schemas";

/** Register campaign attachment-set creation, upload, and removal routes. */
export function registerAttachmentRoutes(app: Hono<MailFlowAppEnv>): void {
  app.post("/api/attachment-sets", async (context) => {
    const authenticated = await requireMutationSession(context);
    if (authenticated instanceof Response) return authenticated;
    if (!attachmentInfrastructureAvailable(context)) {
      return responseError(context, 409, "attachments_unavailable", "Attachments require SMTP delivery.");
    }
    if (!(await smtpAuthorizedFor(context, authenticated.user.id))) {
      return responseError(context, 409, "smtp_reauthorization_required", "Reconnect Microsoft before adding attachments.");
    }
    if (!(await oneDriveAuthorizedFor(context, authenticated.user.id))) {
      return responseError(context, 409, "onedrive_authorization_required", "Connect OneDrive before adding attachments.");
    }
    const input = await parseOrError(context, attachmentSetCreateSchema);
    if (input instanceof Response) return input;
    const repo = repositories(context);
    const service = attachmentServiceFor(context, repo);
    if (!service) return responseError(context, 503, "attachment_storage_unavailable", "Campaign attachments are not available yet.");
    try {
      const result = await service.createSet(authenticated.user.id, input.idempotencyKey);
      return context.json({ attachmentSet: publicAttachmentSet(result.set) }, result.created ? 201 : 200);
    } catch (error) {
      return attachmentErrorResponse(context, error);
    }
  });

  app.post("/api/attachment-sets/:id/files", async (context) => {
    const authenticated = await requireMutationSession(context);
    if (authenticated instanceof Response) return authenticated;
    if (!attachmentInfrastructureAvailable(context)) {
      return responseError(context, 409, "attachments_unavailable", "Attachments require SMTP delivery.");
    }
    if (!(await smtpAuthorizedFor(context, authenticated.user.id))) {
      return responseError(context, 409, "smtp_reauthorization_required", "Reconnect Microsoft before adding attachments.");
    }
    if (!(await oneDriveAuthorizedFor(context, authenticated.user.id))) {
      return responseError(context, 409, "onedrive_authorization_required", "Connect OneDrive before adding attachments.");
    }
    const contentLengthHeader = context.req.header("Content-Length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      // Allow a bounded multipart envelope while rejecting obviously oversized
      // requests before form-data parsing allocates their body in the Worker.
      if (Number.isFinite(contentLength) && contentLength > ATTACHMENT_MAX_BYTES + 64 * 1024) {
        return responseError(context, 413, "attachment_size_limit_exceeded", "The combined attachment size exceeds 20 MiB.");
      }
    }
    const repo = repositories(context);
    const service = attachmentServiceFor(context, repo);
    if (!service) return responseError(context, 503, "attachment_storage_unavailable", "Campaign attachments are not available yet.");
    let uploaded: FormDataEntryValue | null = null;
    try {
      uploaded = (await context.req.raw.formData()).get("file");
    } catch {
      return responseError(context, 422, "invalid_input", "Choose an attachment file and try again.");
    }
    if (!uploaded || typeof uploaded === "string" || typeof uploaded.arrayBuffer !== "function" || typeof uploaded.name !== "string") {
      return responseError(context, 422, "invalid_input", "Choose an attachment file and try again.");
    }
    if (typeof uploaded.size === "number" && uploaded.size > ATTACHMENT_MAX_BYTES) {
      return responseError(context, 413, "attachment_size_limit_exceeded", "This attachment exceeds the campaign attachment size limit.");
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await uploaded.arrayBuffer();
    } catch {
      return responseError(context, 422, "invalid_input", "The attachment could not be read. Choose it again and try again.");
    }
    try {
      const result = await service.addFile(authenticated.user.id, routeParam(context, "id"), {
        filename: uploaded.name,
        contentType: uploaded.type || null,
        bytes,
      });
      return context.json({
        file: publicAttachmentFile(result.file),
        attachmentSet: publicAttachmentSet(result.set),
      }, 201);
    } catch (error) {
      return attachmentErrorResponse(context, error);
    }
  });

  app.delete("/api/attachment-sets/:id/files/:fileId", async (context) => {
    const authenticated = await requireMutationSession(context);
    if (authenticated instanceof Response) return authenticated;
    if (!(await oneDriveAuthorizedFor(context, authenticated.user.id))) {
      return responseError(context, 409, "onedrive_authorization_required", "Connect OneDrive before changing attachments.");
    }
    const repo = repositories(context);
    const service = attachmentServiceFor(context, repo);
    if (!service) return responseError(context, 503, "attachment_storage_unavailable", "Campaign attachments are not available yet.");
    try {
      const removed = await service.removeFile(authenticated.user.id, routeParam(context, "id"), routeParam(context, "fileId"));
      if (!removed) return responseError(context, 404, "attachment_file_not_found", "That attachment is not available.");
      return context.body(null, 204);
    } catch (error) {
      return attachmentErrorResponse(context, error);
    }
  });
}
