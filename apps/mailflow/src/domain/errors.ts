export type DomainErrorCode =
  | "invalid_input"
  | "invalid_transition"
  | "not_found"
  | "ownership_denied"
  | "unsafe_retry"
  | "invariant_violation";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: readonly ValidationIssue[];

  constructor(code: DomainErrorCode, message: string, details: readonly ValidationIssue[] = []) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export interface ValidationIssue {
  code: string;
  message: string;
  field?: string;
  row?: number;
}

