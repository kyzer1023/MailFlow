import type { ReactNode } from "react";

export interface StatusChipProps {
  readonly status: string;
  readonly children?: ReactNode;
}

export function StatusChip({ status, children }: StatusChipProps) {
  return <span className={`status status--${status}`}><span aria-hidden="true" />{children || status}</span>;
}
