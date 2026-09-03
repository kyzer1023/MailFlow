import type { ReactNode } from "react";

export interface FieldProps {
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly errorId?: string;
}

export function Field({ label, children, hint, error, errorId }: FieldProps) {
  return <label className={`field${error ? " field--error" : ""}`}><span>{label}</span>{children}{error ? <small className="field-error" id={errorId} role="alert">{error}</small> : hint && <small>{hint}</small>}</label>;
}
