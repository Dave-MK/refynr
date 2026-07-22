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

/**
 * Upper bound on the `cells` list an advisory finding carries. `cells` exists
 * so a UI can jump to and highlight the affected cells — the jump only needs
 * the first one and the highlight only shows what's on screen, but a gappy
 * column in a 100k-row Parquet file would otherwise hand the shell a CellRef
 * per row, per column. Collect in row order and the cap keeps the earliest
 * cells (and so the jump target) intact.
 */
export const MAX_FINDING_CELLS = 1000;

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
