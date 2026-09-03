import { ArrowClockwise, CheckCircle, CloudArrowUp, Paperclip, SpinnerGap, X } from "@phosphor-icons/react";
import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  attachmentMediaType,
  attachmentTotalBytes,
  formatAttachmentSize,
  validateAttachmentSelection,
} from "../../../client";
import type { CampaignAttachment } from "../../../client/types";
import { localAttachmentId } from "../../lib/ids";
import { useDraft } from "../../state/draft-context";
import { AttachmentIcon } from "./AttachmentIcon";

export function AttachmentPicker() {
  const state = useDraft();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const locked = Boolean(state.campaignResponse);
  const totalBytes = attachmentTotalBytes(state.attachments.filter((item) => item.status !== "error"));

  const addFiles = (fileList: FileList | null | undefined) => {
    if (locked) return;
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const result = validateAttachmentSelection(files, state.attachments);
    const rejectedEntries: CampaignAttachment[] = result.rejected.map((error) => ({
      id: localAttachmentId(),
      name: error.name || "Unnamed file",
      mediaType: error.mediaType,
      byteSize: error.size,
      status: "error",
      error: error.message,
    }));
    const acceptedEntries: CampaignAttachment[] = result.accepted.map((file) => ({
      id: localAttachmentId(),
      name: file.name,
      mediaType: attachmentMediaType(file),
      byteSize: file.size,
      status: "uploading",
    }));
    if (rejectedEntries.length > 0 || acceptedEntries.length > 0) {
      state.setAttachments((current) => [...current, ...rejectedEntries, ...acceptedEntries]);
    }
    result.accepted.forEach((file, index) => {
      void state.uploadAttachment(acceptedEntries[index].id, file);
    });
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(event.currentTarget.files);
    // Permit selecting the same file again after removing or retrying it.
    event.currentTarget.value = "";
  };
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLLabelElement>) => {
    if (locked) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  return <section className="attachment-picker" aria-labelledby="campaign-attachments-heading">
    <div className="attachment-picker__heading">
      <div><span className="section-kicker">CAMPAIGN FILES</span><h2 id="campaign-attachments-heading">Add attachments</h2><p>Every recipient receives the same files in this campaign.</p></div>
      <Paperclip aria-hidden="true" />
    </div>
    <label
      className={`attachment-dropzone${dragging ? " attachment-dropzone--dragging" : ""}${locked ? " attachment-dropzone--locked" : ""}`}
      htmlFor="campaign-attachments-input"
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-disabled={locked}
      onKeyDown={onKeyDown}
      onDragEnter={(event) => { event.preventDefault(); if (!locked) setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); if (!locked) setDragging(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <CloudArrowUp aria-hidden="true" />
      <span><strong>{locked ? "Attachments locked" : "Drop files here or choose files"}</strong><small>PDF, Word, Excel, PowerPoint, CSV, text, PNG, or JPEG</small></span>
      <input ref={inputRef} id="campaign-attachments-input" className="attachment-picker__input" type="file" accept={ATTACHMENT_ACCEPT} multiple disabled={locked} onChange={onInput} />
    </label>
    <div className="attachment-picker__limits"><span>{state.attachments.length} of {ATTACHMENT_MAX_FILES} files</span><span>{formatAttachmentSize(totalBytes)} of {formatAttachmentSize(ATTACHMENT_MAX_BYTES)}</span></div>
    {locked && <p className="attachment-lock-note" role="status"><CheckCircle weight="fill" /> Attachments are locked for this campaign.</p>}
    {state.attachments.length > 0 && <ul className="attachment-list" aria-label="Campaign attachments">
      {state.attachments.map((attachment) => <li className={`attachment-item attachment-item--${attachment.status}`} key={attachment.id} aria-busy={attachment.status === "uploading"}>
        <span className="attachment-item__icon"><AttachmentIcon mediaType={attachment.mediaType} /></span>
        <div className="attachment-item__body"><strong>{attachment.name}</strong><small>{formatAttachmentSize(attachment.byteSize)} · <span className={`attachment-item__status attachment-item__status--${attachment.status}`}>{attachment.status === "uploading" ? "Uploading" : attachment.status === "ready" ? "Ready" : "Upload failed"}</span></small>{attachment.error && <span className="attachment-item__error" role="alert">{attachment.error}</span>}</div>
        <div className="attachment-item__actions">
          {attachment.status === "uploading" && <SpinnerGap className="spin" aria-label={`Uploading ${attachment.name}`} />}
          {attachment.status === "error" && <button type="button" className="attachment-action" onClick={() => state.retryAttachment(attachment.id)} disabled={locked} aria-label={`Retry upload ${attachment.name}`} title="Retry upload"><ArrowClockwise /></button>}
          {!locked && <button type="button" className="attachment-action" onClick={() => void state.removeAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`} title="Remove attachment"><X /></button>}
        </div>
      </li>)}
    </ul>}
    {state.attachmentsUploading && <p className="attachment-live-status" role="status" aria-live="polite">Uploading attachments...</p>}
    {state.attachmentsHaveErrors && <p className="attachment-live-status attachment-live-status--error" role="alert">Remove failed attachments or retry before continuing to Review.</p>}
  </section>;
}
