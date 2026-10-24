// Public surface of the sheetmodel reader.

export { readWorkbook, findSheet, cellAt, isFormulaCell, isMergedNonAnchor, type ReadOptions } from './model.ts';
export type {
  CachedType,
  CachedValue,
  Cell,
  CellOpaqueCategory,
  Coverage,
  DefinedName,
  FormulaKind,
  OpaqueEntry,
  Sheet,
  SheetState,
  SkippedRule,
  WorkbookModel,
} from './types.ts';
export { GateError, isGateError, type GateErrorCode, type GateErrorDetail, type GateErrorJson } from './gateError.ts';
export {
  DEFAULT_LIMITS,
  MAX_COMPRESSED_BYTES,
  MAX_DECLARED_BYTES,
  MAX_FORMULA_CELLS,
  MAX_INFLATED_BYTES,
  MAX_PARTS,
  MAX_SHEETS,
  resolveLimits,
  type Limits,
} from './limits.ts';
export { checkFileName, openZip, type ZipArchive, type ZipEntry } from './zipGate.ts';
export {
  ERROR_LITERALS,
  opaqueCategories,
  tokenTarget,
  tokenize,
  type CellPart,
  type ErrorLiteral,
  type LinePart,
  type OpaqueCategory,
  type RefTarget,
  type Token,
  type TokenKind,
} from './tokenizer.ts';
export {
  cellPartToR1C1,
  formatCellPart,
  formatTarget,
  parseR1C1Cell,
  rebaseFormula,
  sheetNameResolver,
  shiftCellPart,
  shiftTarget,
  toR1C1,
  tokensToR1C1,
  type Anchor,
  type RebaseResult,
  type SheetNameResolver,
} from './r1c1.ts';
export { expandSharedFormula, markArrayMembers, type SharedFormulaMaster } from './sharedFormulas.ts';
export { isDateFormat, isPercentFormat, scanFormatCode, BUILTIN_NUM_FMTS } from './styles.ts';
