import { AddressRuleField } from "./AddressRuleField";
import { Field } from "../common/Field";
import { columnOptions } from "../../lib/view-models";
import { useDraft } from "../../state/draft-context";
import type { MailImportance } from "../../../domain/types";

export function SendingOptions() {
  const { draft, updateDraft, table } = useDraft();
  const options = columnOptions(table);
  return (
    <div className="sending-options-fields">
      {(["cc", "bcc", "replyTo"] as const).map((key) => (
        <AddressRuleField
          key={key}
          fieldKey={key}
          label={key === "replyTo" ? "Reply-to" : key.toUpperCase()}
          value={draft[key]}
          mode={draft[`${key}Mode`]}
          column={draft[`${key}Column`]}
          options={options}
          onValue={(value) => updateDraft(key, value)}
          onMode={(value) => updateDraft(`${key}Mode`, value)}
          onColumn={(value) => updateDraft(`${key}Column`, value)}
        />
      ))}
      <Field label="Importance">
        <select
          value={draft.importance}
          onChange={(event) =>
            updateDraft("importance", event.target.value as MailImportance)
          }
        >
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </Field>
    </div>
  );
}
