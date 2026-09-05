import { useEffect, useRef, useState } from "react";
import type { RecipientJobRecord } from "../../../domain/types";
import { verifyDelivery } from "../../api";
import { formatTimestamp } from "../../lib/format";
import { Modal } from "./Modal";

export function DeliveryVerification({
  job,
  csrfToken,
  onVerified,
}: {
  job: RecipientJobRecord;
  csrfToken: string;
  onVerified: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const evidence = useRef<HTMLDivElement>(null);
  const savedHere = useRef(false);
  useEffect(() => {
    if (savedHere.current && job.deliveryVerifiedAt) evidence.current?.focus();
  }, [job.deliveryVerifiedAt]);
  if (job.deliveryVerifiedAt)
    return (
      <div
        ref={evidence}
        tabIndex={-1}
        className="delivery-evidence"
        role="status"
      >
        <strong>Delivery verified by you</strong>
        <small>{formatTimestamp(job.deliveryVerifiedAt)}</small>
        <small>
          Member-reported receipt. Provider outcome remains Unknown.
        </small>
        {job.deliveryVerificationNote && <p>{job.deliveryVerificationNote}</p>}
      </div>
    );
  return (
    <>
      <button
        className="button button--outline button--small"
        onClick={() => {
          setConfirmed(false);
          setError("");
          setOpen(true);
        }}
      >
        Mark delivery verified
      </button>
      {open && (
        <Modal
          title="Verify receipt for this row"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form
            className="delivery-verification"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!confirmed || busy) return;
              setBusy(true);
              setError("");
              try {
                await verifyDelivery(job.campaignId, job.id, note, csrfToken);
                savedHere.current = true;
                setOpen(false);
                onVerified();
              } catch {
                setError(
                  "The confirmation could not be saved. Try again; an earlier confirmation will be preserved.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Row {job.sourceRow}: {job.recipient}
            </p>
            <p>
              Check the recipient's receipt before confirming. This records your
              verification and keeps the provider outcome as Unknown. It does
              not send another message.
            </p>
            <label className="ack">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
              />
              I have verified that this message was received.
            </label>
            <label className="field">
              Optional note (500 characters maximum)
              <input
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
              />
            </label>
            <small>
              Keep the note brief. Do not include passwords, message content, or
              private account details.
            </small>
            {error && <p role="alert">{error}</p>}
            <button
              className="button button--coral"
              disabled={!confirmed || busy}
            >
              {busy ? "Saving confirmation..." : "Confirm delivery verified"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
