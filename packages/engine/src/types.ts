/** A single cell value as parsed from CSV/XLSX/paste. */
export type CellValue = string | number | boolean | null;

/** The immutable input table. The engine never mutates this. */
export interface Table {
  headers: string[];
  rows: CellValue[][];
}

export interface CellRef {
  /** 0-based data row index (excludes header). */
  row: number;
  /** 0-based column index. */
  col: number;
}

interface PatchBase {
  /** Deterministic id, e.g. "trim-whitespace:12:3". */
  id: string;
  /** Rule that produced this patch, e.g. "normalize-date". */
  rule: string;
  /** Human-readable explanation — powers the "why did this change?" view. */
  reason: string;
  /** 0–1. Deterministic fixes are 1; inferred fixes are lower. */
  confidence: number;
}

/** A proposed change to a single cell. */
export interface CellPatch extends PatchBase {
  kind: "cell";
  cell: CellRef;
  before: CellValue;
  after: CellValue;
}

/** A proposed removal of an entire row (e.g. exact duplicate). */
export interface RowRemovalPatch extends PatchBase {
  kind: "remove-row";
  row: number;
  /** Row index this one duplicates, if applicable. */
  duplicateOf?: number;
}

/** A proposed change to a column header (trim, dedupe). */
export interface HeaderPatch extends PatchBase {
  kind: "header";
  col: number;
  before: string;
  after: string;
}

export type Patch = CellPatch | RowRemovalPatch | HeaderPatch;

export type Severity = "info" | "warning" | "error";

/** A quality issue surfaced to the user, optionally with patches that fix it. */
export interface Finding {
  rule: string;
  severity: Severity;
  /** Short headline, e.g. "37 invalid email addresses". */
  title: string;
  /** Longer explanation with advice. */
  detail: string;
  /** Number of affected cells/rows. */
  count: number;
  /** Column index if the finding is column-scoped. */
  column?: number;
  /** Cells this finding refers to (advisory findings — lets UIs highlight them). */
  cells?: CellRef[];
  /** Ids of patches that resolve this finding (empty = advisory only). */
  patchIds: string[];
}

export type ColumnType =
  | "empty"
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "email"
  | "phone"
  | "postcode"
  | "url"
  | "id"
  | "mixed";

export interface ColumnProfile {
  index: number;
  name: string;
  type: ColumnType;
  /** Share of non-empty values matching the inferred type (0–1). */
  typeConfidence: number;
  nonEmpty: number;
  empty: number;
  distinct: number;
  samples: string[];
}

export interface TableProfile {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
}

export interface ScoreDimension {
  key: "validity" | "consistency" | "completeness" | "uniqueness";
  label: string;
  /** 0–100 */
  score: number;
  /** Number of issues counted against this dimension. */
  issues: number;
}

export interface HealthScore {
  /** 0–100 weighted composite. */
  overall: number;
  dimensions: ScoreDimension[];
}

/** Date interpretation for ambiguous numeric dates like 03/04/2024. */
export type DateOrder = "auto" | "DMY" | "MDY";

export interface EngineOptions {
  /** How to read ambiguous dates. "auto" infers from unambiguous values in the column. */
  dateOrder?: DateOrder;
  /** Output format for normalized dates. */
  dateOutput?: "iso" | "uk" | "us";
  /** Rules to skip entirely. */
  disabledRules?: string[];
  /** User-defined expectations checked as pass/fail advisories (never auto-fixed). */
  constraints?: Constraint[];
  /**
   * Header names of the columns that identify a record for duplicate
   * detection. When set, rows matching on just these columns are exact
   * duplicates (first kept); when empty/omitted, the whole row must match.
   * Names (not indices) so the key survives recipes, re-exports with
   * reordered columns, and shape transforms — like `Constraint.column`.
   * Names that don't exist in the table are ignored.
   */
  dedupeKey?: string[];
}

/**
 * A user-defined expectation about a column — the "expectations-lite" layer.
 * Constraints are checked and reported (pass/fail), never auto-fixed: refynr
 * asserts, it doesn't guess a value that would satisfy the rule. Columns are
 * referenced by header name so a constraint stays valid across re-exports even
 * if column order changes.
 */
export interface Constraint {
  /** Header name of the column this applies to. */
  column: string;
  type: "not-null" | "unique" | "regex" | "range" | "allowed-values";
  /** For type "regex": a JS regular-expression source (no slashes). */
  pattern?: string;
  /** For type "range": inclusive bounds (either may be omitted). */
  min?: number;
  max?: number;
  /** For type "allowed-values": the permitted set (compared case-sensitively). */
  values?: string[];
}

export interface CleanseResult {
  profile: TableProfile;
  findings: Finding[];
  patches: Patch[];
  score: HealthScore;
  /** Score if every proposed patch were accepted. */
  projectedScore: HealthScore;
}
