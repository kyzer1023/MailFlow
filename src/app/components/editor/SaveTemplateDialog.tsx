import { useEffect, useRef, useState } from "react";
import { Field } from "../common/Field";
import { Modal } from "../common/Modal";

export function SaveTemplateDialog({
  currentName,
  existing,
  saving,
  error,
  onClose,
  onSave,
}: {
  readonly currentName: string;
  readonly existing: boolean;
  readonly saving: boolean;
  readonly error: string;
  readonly onClose: () => void;
  readonly onSave: (name: string, update: boolean) => void;
}) {
  const [name, setName] = useState(
    existing ? `${currentName} copy`.slice(0, 120) : currentName,
  );
  const [update, setUpdate] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (error) nameRef.current?.focus();
  }, [error]);
  return (
    <Modal
      title="Save this message for next time"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <p className="dialog-intro">
        Keep the message and sending rules as a reusable template.
      </p>
      {existing && (
        <div className="save-mode">
          <label>
            <input
              type="radio"
              name="save-mode"
              checked={!update}
              disabled={saving}
              onChange={() => setUpdate(false)}
            />
            <span>
              <strong>Save as a new template</strong>
              <small>Keep the original template as it is.</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="save-mode"
              checked={update}
              disabled={saving}
              onChange={() => {
                setUpdate(true);
                setName(currentName);
              }}
            />
            <span>
              <strong>Update {currentName}</strong>
              <small>
                Future sends will use this version. Past sends stay unchanged.
              </small>
            </span>
          </label>
        </div>
      )}
      <Field label="Template name">
        <input
          ref={nameRef}
          value={name}
          maxLength={120}
          disabled={saving}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "template-save-error" : undefined}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim() && !saving) {
              event.preventDefault();
              onSave(name.trim(), update);
            }
          }}
          onChange={(event) => setName(event.target.value)}
          placeholder="For example, Workshop invitation"
        />
      </Field>
      <div className="notice">
        <span>
          <strong>Saved with the template</strong>Subject, message, spreadsheet
          field names, and sending rules.
          <p>Recipients and attachment files belong only to this send.</p>
        </span>
      </div>
      {error && (
        <p className="error-text" id="template-save-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button
          className="button button--outline"
          disabled={saving}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="button button--coral"
          disabled={saving || !name.trim()}
          onClick={() => onSave(name.trim(), update)}
        >
          {saving ? "Saving..." : update ? "Update template" : "Save template"}
        </button>
      </footer>
    </Modal>
  );
}
