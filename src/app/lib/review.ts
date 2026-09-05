import type { ClientValidationIssue } from "../../client/types";
import type { ValidationIssueAction } from "../state/types";

export function splitFixedAddresses(value: unknown): string[] {
  return String(value || "").split(/[;,\n]+/u).map((part) => part.trim()).filter(Boolean);
}

export function validationIssueAction(issue: ClientValidationIssue): ValidationIssueAction {
  if (["missing_mapping", "missing_column", "missing_to_mapping"].includes(issue.code)) {
    return issue.field === "toField" ? { label: "Choose recipient column", to: "/flows/new/data" } : { label: "Connect message values", to: "/flows/new/template" };
  }
  if (["missing_subject", "missing_body", "unsafe_html"].includes(issue.code)) {
    return { label: "Edit message", to: "/flows/new/template" };
  }
  return issue.field === "to" ? { label: "Review recipients", to: "/flows/new/data" } : { label: "Review sending options", to: "/flows/new/template" };
}

export function uniqueValidationIssues(issues: readonly ClientValidationIssue[]): readonly ClientValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.field || ""}:${issue.row || ""}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
