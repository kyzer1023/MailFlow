import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Field } from "../common/Field";
import { dynamicFieldLabel } from "../../lib/editor-dom";
import { replaceMessageField, suggestColumn } from "../../lib/template-reuse";
import { columnOptions } from "../../lib/view-models";
import { useDraft } from "../../state/draft-context";

export function FieldResolutionPanel({
  fields,
  missingFields,
  onReplace,
}: {
  readonly fields: readonly string[];
  readonly missingFields: readonly string[];
  readonly onReplace: () => void;
}) {
  const { setDraft, table, mapping } = useDraft();
  const options = columnOptions(table);
  const [textFields, setTextFields] = useState<Record<string, string>>({});
  const selects = useRef<Record<string, HTMLSelectElement | null>>({});
  const connect = (key: string, column: string) => {
    setDraft((current) => ({
      ...current,
      mappings: { ...current.mappings, [key]: column },
    }));
  };
  return (
    <section
      className="field-resolution-panel"
      aria-label="Message value connections"
    >
      <h2>
        {missingFields.length
          ? `${missingFields.length} ${missingFields.length === 1 ? "value" : "values"} to connect`
          : "Message value connections"}
      </h2>
      <p
        className={
          missingFields.length ? undefined : "field-connection-success"
        }
        role="status"
        aria-atomic="true"
      >
        {missingFields.length
          ? `Columns in your file: ${options.map((option) => option.label).join(", ")}`
          : "All message values are connected. You can change a column below."}
      </p>
      <div className="field-resolutions">
        {fields.map((key) => {
          const label = dynamicFieldLabel(key);
          const connected = !missingFields.includes(key);
          const column = connected ? mapping.placeholders?.[key] || "" : "";
          const suggestion = suggestColumn(key, table);
          const suggestedLabel = options.find(
            (option) => option.value === suggestion,
          )?.label;
          return (
            <section key={key} aria-label={`${label} connection`}>
              <h3>
                {label}
                <span
                  className={connected ? "field-connection-success" : undefined}
                >
                  {connected ? (
                    <CheckCircle weight="fill" />
                  ) : (
                    <WarningCircle />
                  )}
                  {connected ? "Connected" : "Not connected"}
                </span>
              </h3>
              <Field label={`Column for ${label}`}>
                <select
                  ref={(element) => {
                    selects.current[key] = element;
                  }}
                  value={column}
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
              {!connected && suggestion && (
                <>
                  <p>Suggested: {suggestedLabel}</p>
                  <button
                    className="button button--outline"
                    onClick={() => {
                      connect(key, suggestion);
                      selects.current[key]?.focus({ preventScroll: true });
                    }}
                  >
                    Use {suggestedLabel}
                  </button>
                </>
              )}
              {!connected &&
                (Object.hasOwn(textFields, key) ? (
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
                        onReplace();
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
                ))}
            </section>
          );
        })}
      </div>
      <p>
        Each message value uses its selected column for every recipient. These
        choices only affect this message.
      </p>
    </section>
  );
}
