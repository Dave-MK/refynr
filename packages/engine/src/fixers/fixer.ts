import type {
  EngineOptions,
  Finding,
  Patch,
  Table,
  TableProfile,
} from "../types.js";

export interface FixerContext {
  table: Table;
  profile: TableProfile;
  options: Required<EngineOptions>;
}

export interface FixerOutput {
  findings: Finding[];
  patches: Patch[];
}

export interface Fixer {
  rule: string;
  run(ctx: FixerContext): FixerOutput;
}

export const EMPTY_OUTPUT: FixerOutput = { findings: [], patches: [] };

export function cellPatchId(rule: string, row: number, col: number): string {
  return `${rule}:${row}:${col}`;
}

/** "1 blank row" / "3 blank rows" — keeps finding copy grammatical. */
export function n(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/** "is" / "are" style verb agreement. */
export function verb(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
