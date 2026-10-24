// Typed refusal raised by the input gate and the reader. Every refusal the UI shows is one of
// these codes; the message is plain English and never includes workbook cell content.

export type GateErrorCode =
  // file-level
  | 'unsupported-extension'
  | 'ole-compound-file'
  | 'not-zip'
  | 'compressed-too-large'
  // zip structure
  | 'bad-zip'
  | 'zip64-unsupported'
  | 'multi-disk-unsupported'
  | 'too-many-parts'
  | 'bad-entry-name'
  | 'absolute-path'
  | 'path-traversal'
  | 'backslash-in-name'
  | 'duplicate-entry'
  | 'encrypted-entry'
  | 'unsupported-compression'
  | 'overlapping-entries'
  | 'vba-project'
  | 'declared-too-large'
  // inflation
  | 'inflated-too-large'
  | 'entry-size-mismatch'
  | 'corrupt-entry'
  // package and XML content
  | 'macro-content-type'
  | 'doctype-forbidden'
  | 'bad-xml'
  | 'missing-part'
  // workbook caps
  | 'too-many-sheets'
  | 'too-many-formulas';

export type GateErrorDetail = Readonly<Record<string, string | number>>;

export interface GateErrorJson {
  code: GateErrorCode;
  message: string;
  detail?: GateErrorDetail;
}

export class GateError extends Error {
  readonly code: GateErrorCode;
  readonly detail: GateErrorDetail | undefined;

  constructor(code: GateErrorCode, message: string, detail?: GateErrorDetail) {
    super(message);
    this.name = 'GateError';
    this.code = code;
    this.detail = detail;
  }

  /** Plain object for postMessage / UI (Error subclasses do not survive structured clone). */
  toJSON(): GateErrorJson {
    return this.detail === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, detail: this.detail };
  }
}

export function isGateError(value: unknown): value is GateError {
  return value instanceof GateError;
}
