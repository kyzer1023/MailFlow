import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { Field } from "../common/Field";
import { dynamicFieldLabel } from "../../lib/editor-dom";
import { replaceMessageField, suggestColumn } from "../../lib/template-reuse";
import { columnOptions } from "../../lib/view-models";
import { useDraft } from "../../state/draft-context";

export function FieldResolutionPanel({
  fields,
}: {
  readonly fields: readonly string[];
}) {
  const { setDraft, table, mapping } = useDraft();
  const options = columnOptions(table);
  const [textFields, setTextFields] = useState<Record<string, string>>({});
  const focusNext = () =>
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>(".field-resolution-panel select") ||
        document.querySelector<HTMLElement>(".subject-editor")
      )?.focus(),
    );
  const connect = (key: string, column: string) => {
    if (column) {
      setDraft((current) => ({
        ...current,
        mappings: { ...current.mappings, [key]: column },
      }));
      focusNext();
    }
  };
  return (
    <section
      className="field-resolution-panel"
      aria-label="Connect missing message values"
    >
      <h2>
        {fields.length} {fields.length === 1 ? "value" : "values"} to connect
      </h2>
      <p>
        Columns in your file: {options.map((option) => option.label).join(", ")}
      </p>
      <div className="field-resolutions">
        {fields.map((key) => {
          const label = dynamicFieldLabel(key);
          const suggestion = suggestColumn(key, table);
          const suggestedLabel = options.find(
            (option) => option.value === suggestion,
          )?.label;
          return (
            <section key={key}>
              <h3>
                {label}
                <span>
                  <WarningCircle /> Not connected
                </span>
              </h3>
              <Field label={`Column for ${label}`}>
                <select
                  value=""
                  onChange={(event) => connect(key, event.target.value)}
                >
                  <option value="">Choose a column</option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              {suggestion && (
                <>
                  <p>Suggested: {suggestedLabel}</p>
                  <button
                    className="button button--outline"
                    onClick={() => connect(key, suggestion)}
                  >
                    Use {suggestedLabel}
                  </button>
                </>
              )}
              {Object.hasOwn(textFields, key) ? (
                <>
                  <Field label={`Text for ${label}`}>
                    <input
                      autoFocus
                      value={textFields[key]}
                      placeholder="The same text for everyone"
                      onChange={(event) =>
                        setTextFields((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <button
                    className="button button--outline"
                    disabled={!textFields[key].trim()}
                    onClick={() => {
                      setDraft((current) =>
                        replaceMessageField(current, key, textFields[key]),
                      );
                      focusNext();
                    }}
                  >
                    Replace {label} with text
                  </button>
                </>
              ) : (
                <button
                  className="button button--text"
                  onClick={() =>
                    setTextFields((current) => ({ ...current, [key]: "" }))
                  }
                >
                  Replace with text
                </button>
              )}
            </section>
          );
        })}
      </div>
      <p>
        You can also remove a value in the message editor. These choices only
        affect this message.
      </p>
      {Object.entries(mapping.placeholders || {})
        .filter(([key, value]) => !fields.includes(key) && value)
        .map(([key, value]) => (
          <p className="field-connected" key={key}>
            <CheckCircle weight="fill" />
            {dynamicFieldLabel(key)} is connected to{" "}
            {dynamicFieldLabel(value, options)}
          </p>
        ))}
    </section>
  );
}
