// WorkbookModel contract (PLAN §4). Fields beyond §4 are additive and marked "(additive)".

import type { CellRef, Range } from '../util/addr.ts';
import type { OpaqueCategory } from './tokenizer.ts';
import type { SheetState } from './parts.ts';

export type { SheetState } from './parts.ts';

/** Cached value type as stored: n, s (shared string), str (formula string), inlineStr, b, e; none = no cache. */
export type CachedType = 'n' | 's' | 'str' | 'inlineStr' | 'b' | 'e' | 'none';
export type CachedValue = string | number | boolean | null;

/** `dataTable` (additive): what-if data-table cells (`<f t="dataTable">`), always opaque. */
export type FormulaKind = 'normal' | 'shared' | 'array' | 'dataTable';

/** Opaque categories at cell level: tokenizer categories plus reader-level ones. */
export type CellOpaqueCategory = OpaqueCategory | 'data-table' | 'unresolved-shared';

export interface Cell {
  /** A1 address without anchors, e.g. `B12`. */
  addr: string;
  row: number;
  col: number;
  /** Formula text without `=`; shared-formula children hold their expanded (re-based) text. */
  formula?: string;
  formulaKind?: FormulaKind;
  /** On an array-formula anchor: the array's `ref` (e.g. `C1:C3`). */
  arrayRef?: string;
  /** (additive) On array members other than the anchor: the anchor's A1 address. */
  arrayAnchor?: string;
  /** True for every cell inside an array formula's `ref`, the anchor included. */
  inArray?: boolean;
  /** (additive) R1C1 form of `formula` relative to this cell (see r1c1.ts). */
  r1c1?: string;
  /** (additive) Opaque categories found in this cell's formula; rules skip such formulas. */
  opaque?: CellOpaqueCategory[];
  cachedType: CachedType;
  /** Missing cache is `null` with cachedType `none`: unknown, never zero. */
  cachedValue: CachedValue;
  styleId?: number;
  numFmtId?: number;
  numFmtCode?: string;
  isPercentFmt: boolean;
  isDateFmt: boolean;
}

export interface Sheet {
  name: string;
  /** Position in workbook.xml's <sheets> (matches definedName localSheetId). */
  index: number;
  hidden: boolean;
  /** (additive) visible / hidden / veryHidden. */
  state: SheetState;
  /** Keyed by A1 address without anchors. Cells with neither formula nor value are omitted. */
  cells: Map<string, Cell>;
  merges: Range[];
  maxRow: number;
  maxCol: number;
}

export interface DefinedName {
  name: string;
  /** Formula text as stored (no `=`). */
  formula: string;
  /** Sheet the name is scoped to; undefined for workbook scope. */
  scopeSheet?: string;
  localSheetId?: number;
  hidden: boolean;
}

export interface OpaqueEntry {
  cell: CellRef;
  category: CellOpaqueCategory;
}

export interface SkippedRule {
  ruleId: string;
  reason: string;
}

export interface Coverage {
  /** Formula cells, counted after shared-formula expansion. */
  formulaCells: number;
  opaque: OpaqueEntry[];
  /** Filled by the rules engine (M2+); the reader leaves it empty. */
  skippedRules: SkippedRule[];
  notes: string[];
}

export interface WorkbookModel {
  sheets: Sheet[];
  definedNames: DefinedName[];
  /** External workbook targets, listed and never followed; index i is `[i+1]` in formulas. */
  externalLinks: string[];
  coverage: Coverage;
  /** (additive) workbookPr date1904. */
  date1904: boolean;
}
