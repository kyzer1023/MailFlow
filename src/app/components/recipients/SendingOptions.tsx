import { AddressRuleField } from "./AddressRuleField";
import { Field } from "../common/Field";
import { columnOptions } from "../../lib/view-models";
import { useDraft } from "../../state/draft-context";
import type { DraftState } from "../../state/types";

export function SendingOptions() {
  const { draft, setDraft, updateDraft, table } = useDraft();
  const options = columnOptions(table);
  const rule = (
    key: "cc" | "bcc" | "replyTo",
    property: string,
    value: string,
  ) =>
    setDraft(
      (current) =>
        ({
          ...current,
          [property ? `${key}${property}` : key]: value,
        }) as DraftState,
    );
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
          onValue={(value) => rule(key, "", value)}
          onMode={(value) => rule(key, "Mode", value)}
          onColumn={(value) => rule(key, "Column", value)}
        />
      ))}
      <Field label="Importance">
        <select
          value={draft.importance}
          onChange={(event) => updateDraft("importance", event.target.value)}
        >
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </Field>
      <Field label="Separate multiple addresses with">
        <select
          value={draft.separator}
          onChange={(event) => updateDraft("separator", event.target.value)}
        >
          <option value="auto">Detect automatically</option>
          <option value="comma">Comma</option>
          <option value="semicolon">Semicolon</option>
          <option value="newline">New line</option>
        </select>
      </Field>
      <Field
        label="Messages per minute"
        hint="Messages are sent one at a time."
      >
        <input
          type="number"
          min="1"
          max="20"
          value={draft.pace}
          onChange={(event) => updateDraft("pace", Number(event.target.value))}
        />
      </Field>
    </div>
  );
}
