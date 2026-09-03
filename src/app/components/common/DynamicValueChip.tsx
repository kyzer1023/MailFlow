import { BracketsCurly } from "@phosphor-icons/react";
import { dynamicFieldLabel } from "../../lib/editor-dom";
import type { DynamicFieldOption } from "../../state/types";

export interface DynamicValueChipProps {
  readonly value?: string | null;
  readonly options?: readonly DynamicFieldOption[];
  readonly compact?: boolean;
}

export function DynamicValueChip({ value, options = [], compact = false }: DynamicValueChipProps) {
  return <span className={`dynamic-value-chip${compact ? " dynamic-value-chip--compact" : ""}`}><BracketsCurly weight="bold" aria-hidden="true" />{dynamicFieldLabel(value, options)}</span>;
}
