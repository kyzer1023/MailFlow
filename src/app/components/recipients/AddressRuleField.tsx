import { BracketsCurly, Check, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { splitFixedAddresses } from "../../lib/review";
import type { AddressRuleMode, DynamicFieldOption } from "../../state/types";
import { DynamicValueChip } from "../common/DynamicValueChip";

export interface AddressRuleFieldProps {
  readonly fieldKey: string;
  readonly label: string;
  readonly value: string;
  readonly mode: AddressRuleMode;
  readonly column: string;
  readonly options: readonly DynamicFieldOption[];
  readonly onValue: (value: string) => void;
  readonly onMode: (value: AddressRuleMode) => void;
  readonly onColumn: (value: string) => void;
  readonly hint?: string;
}

export function AddressRuleField({
  fieldKey,
  label,
  value,
  mode,
  column,
  options,
  onValue,
  onMode,
  onColumn,
  hint,
}: AddressRuleFieldProps) {
  const [pending, setPending] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const addresses = splitFixedAddresses(value);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: Event) => {
      if (!fieldRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const commitPending = (raw = pending) => {
    const additions = splitFixedAddresses(raw);
    if (additions.length > 0) {
      const seen = new Set(addresses.map((address) => address.toLowerCase()));
      onValue(
        [
          ...addresses,
          ...additions.filter((address) => !seen.has(address.toLowerCase())),
        ].join("; "),
      );
    }
    setPending("");
  };
  const removeAddress = (index: number) =>
    onValue(addresses.filter((_, itemIndex) => itemIndex !== index).join("; "));
  const removeDynamic = () => {
    onMode("fixed");
    onColumn("");
  };

  return (
    <div className="recipient-rule" ref={fieldRef}>
      <label htmlFor={`${fieldKey}-fixed-input`}>{label}</label>
      <div
        className={`address-chip-input${mode === "column" ? " address-chip-input--dynamic" : ""}`}
      >
        <div className="address-chip-values">
          {mode === "column" && column ? (
            <span className="selected-dynamic-value">
              <DynamicValueChip value={column} options={options} />
              <button
                type="button"
                onClick={removeDynamic}
                aria-label={`Remove dynamic ${label} value`}
              >
                <X />
              </button>
            </span>
          ) : (
            addresses.map((address, index) => (
              <span className="address-chip" key={`${address}-${index}`}>
                <span aria-hidden="true">
                  {address.charAt(0).toUpperCase()}
                </span>
                <span className="address-chip-label">{address}</span>
                <button
                  type="button"
                  onClick={() => removeAddress(index)}
                  aria-label={`Remove ${address}`}
                >
                  <X />
                </button>
              </span>
            ))
          )}
          {mode === "fixed" && (
            <input
              id={`${fieldKey}-fixed-input`}
              value={pending}
              onChange={(event) => setPending(event.target.value)}
              onBlur={() => commitPending()}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text/plain");
                if (/[,;\r\n]/u.test(pasted)) {
                  event.preventDefault();
                  // Read the clipboard before a single-line input removes newlines.
                  commitPending([pending, pasted].filter(Boolean).join("; "));
                }
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" ||
                  event.key === "," ||
                  event.key === ";"
                ) {
                  event.preventDefault();
                  commitPending();
                } else if (
                  event.key === "Backspace" &&
                  !pending &&
                  addresses.length > 0
                )
                  removeAddress(addresses.length - 1);
              }}
              placeholder={
                addresses.length ? "Add another" : "Add email addresses"
              }
              autoComplete="off"
            />
          )}
        </div>
        <button
          type="button"
          className="dynamic-menu-trigger"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="listbox"
          aria-label={`Choose a dynamic value for ${label}`}
          title="Choose a spreadsheet value"
        >
          <BracketsCurly weight="bold" />
        </button>
      </div>
      {menuOpen && (
        <div
          className="dynamic-value-menu"
          role="listbox"
          aria-label={`Dynamic values for ${label}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenuOpen(false);
          }}
        >
          <div>
            <strong>Dynamic values</strong>
            <small>
              Choose a spreadsheet column containing email addresses.
            </small>
          </div>
          {options.length > 0 ? (
            options.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={mode === "column" && column === option.value}
                key={option.value}
                onClick={() => {
                  onMode("column");
                  onColumn(option.value);
                  setPending("");
                  setMenuOpen(false);
                }}
              >
                <DynamicValueChip
                  value={option.value}
                  options={options}
                  compact
                />
                {mode === "column" && column === option.value && (
                  <Check weight="bold" />
                )}
              </button>
            ))
          ) : (
            <p>No spreadsheet fields are available.</p>
          )}
        </div>
      )}
      {hint && <small className="recipient-rule-hint">{hint}</small>}
    </div>
  );
}
