import { useCallback, useRef, useState } from "react";
import { validateAttachmentInput } from "../../domain/attachment-policy";
import {
  createAttachmentSet as createAttachmentSetRequest,
  deleteAttachmentFile as deleteAttachmentFileRequest,
  uploadAttachmentFile as uploadAttachmentFileRequest,
} from "../api";
import type { CampaignAttachment } from "../../client/types";
import { attachmentFileFromResponse } from "../lib/attachments";
import { requestKey } from "../lib/ids";

export function useDraftAttachments(
  csrfToken: string,
  campaignPrepared: boolean,
) {
  // Attachment bytes are held by the upload request and this ref only while
  // retry is possible. They are deliberately not part of draft state or any
  // campaign payload.
  const [attachments, setAttachments] = useState<CampaignAttachment[]>([]);
  const [attachmentSetId, setAttachmentSetId] = useState<string | null>(null);
  const attachmentSetIdRef = useRef<string | null>(null);
  const [attachmentSetRequestKey, setAttachmentSetRequestKey] = useState(
    () => `attachment-${requestKey()}`,
  );
  const attachmentSourcesRef = useRef<Map<string, File>>(new Map());
  const attachmentSetPromiseRef = useRef<{
    generation: number;
    promise: Promise<string>;
  } | null>(null);
  const attachmentUploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const attachmentGenerationRef = useRef(0);
  const ensureAttachmentSet = useCallback(async () => {
    if (attachmentSetIdRef.current) return attachmentSetIdRef.current;
    const generation = attachmentGenerationRef.current;
    const currentRequest = attachmentSetPromiseRef.current;
    if (currentRequest && currentRequest.generation === generation)
      return currentRequest.promise;
    const promise = createAttachmentSetRequest(
      attachmentSetRequestKey,
      csrfToken,
    )
      .then((response) => {
        const id = response?.attachmentSet?.id;
        if (!id || attachmentGenerationRef.current !== generation)
          throw new Error(
            "The attachment upload was cancelled. Choose the files again.",
          );
        attachmentSetIdRef.current = id;
        setAttachmentSetId(id);
        return id;
      })
      .finally(() => {
        if (attachmentSetPromiseRef.current?.promise === promise)
          attachmentSetPromiseRef.current = null;
      });
    attachmentSetPromiseRef.current = { generation, promise };
    return promise;
  }, [attachmentSetRequestKey, csrfToken]);
  const performAttachmentUpload = useCallback(
    async (localId: string, file: File, generation: number) => {
      if (attachmentGenerationRef.current !== generation) return;
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === localId
            ? { ...attachment, status: "uploading", error: undefined }
            : attachment,
        ),
      );
      attachmentSourcesRef.current.set(localId, file);
      try {
        validateAttachmentInput({
          filename: file.name,
          contentType: file.type,
          bytes: await file.arrayBuffer(),
        });
        if (attachmentGenerationRef.current !== generation) return;
        const setId = await ensureAttachmentSet();
        if (attachmentGenerationRef.current !== generation) return;
        const response = await uploadAttachmentFileRequest(
          setId,
          file,
          csrfToken,
        );
        if (attachmentGenerationRef.current !== generation) return;
        const next = attachmentFileFromResponse(response);
        attachmentSourcesRef.current.delete(localId);
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.id === localId ? next : attachment,
          ),
        );
      } catch (error) {
        if (attachmentGenerationRef.current !== generation) return;
        const message =
          error instanceof Error
            ? error.message
            : "This file could not be uploaded.";
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.id === localId
              ? { ...attachment, status: "error", error: message }
              : attachment,
          ),
        );
      }
    },
    [csrfToken, ensureAttachmentSet],
  );
  const uploadAttachment = useCallback(
    (localId: string, file: File) => {
      // One attachment set has one conditional file-count update. Serializing
      // the bounded five uploads prevents two browser requests from choosing
      // the same next position or racing that counter in D1.
      const generation = attachmentGenerationRef.current;
      const queued = attachmentUploadQueueRef.current.then(() =>
        performAttachmentUpload(localId, file, generation),
      );
      attachmentUploadQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [performAttachmentUpload],
  );
  const retryAttachment = useCallback(
    (localId: string) => {
      const file = attachmentSourcesRef.current.get(localId);
      if (file) void uploadAttachment(localId, file);
    },
    [uploadAttachment],
  );
  const removeAttachment = useCallback(
    async (localId: string) => {
      if (campaignPrepared) return;
      const attachment = attachments.find((item) => item.id === localId);
      if (!attachment) return;
      const serverId =
        attachment.id && !attachment.id.startsWith("attachment-local-")
          ? attachment.id
          : "";
      try {
        if (serverId && attachmentSetId)
          await deleteAttachmentFileRequest(
            attachmentSetId,
            serverId,
            csrfToken,
          );
        attachmentSourcesRef.current.delete(localId);
        setAttachments((current) =>
          current.filter((item) => item.id !== localId),
        );
      } catch (error) {
        setAttachments((current) =>
          current.map((item) =>
            item.id === localId
              ? {
                  ...item,
                  status: "error",
                  error:
                    error instanceof Error
                      ? error.message
                      : "This file could not be removed.",
                }
              : item,
          ),
        );
      }
    },
    [attachmentSetId, attachments, campaignPrepared, csrfToken],
  );
  const resetAttachmentState = useCallback(() => {
    attachmentGenerationRef.current += 1;
    attachmentSetPromiseRef.current = null;
    attachmentUploadQueueRef.current = Promise.resolve();
    attachmentSourcesRef.current.clear();
    setAttachments([]);
    attachmentSetIdRef.current = null;
    setAttachmentSetId(null);
    setAttachmentSetRequestKey(`attachment-${requestKey()}`);
  }, []);
  const attachmentsUploading = attachments.some(
    (attachment) => attachment.status === "uploading",
  );
  const attachmentsHaveErrors = attachments.some(
    (attachment) => attachment.status === "error",
  );
  const attachmentsReady =
    !attachmentsUploading &&
    !attachmentsHaveErrors &&
    attachments.every((attachment) => attachment.status === "ready");
  return {
    attachments,
    setAttachments,
    attachmentSetId,
    attachmentSetRequestKey,
    attachmentsUploading,
    attachmentsHaveErrors,
    attachmentsReady,
    uploadAttachment,
    retryAttachment,
    removeAttachment,
    resetAttachmentState,
  };
}
