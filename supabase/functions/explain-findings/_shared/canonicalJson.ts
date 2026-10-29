// Canonical JSON: object keys sorted (UTF-16 code-unit order), no whitespace, arrays in
// order, `undefined` object members omitted (as JSON.stringify does). Only plain data is
// accepted: non-finite numbers, bigint, functions, symbols, class instances (Map, Date, ...)
// and cycles throw, so a hash over canonical JSON can never silently drop information.
// No imports: copied verbatim into the edge function's _shared folder.

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function encode(value: unknown, stack: Set<object>): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: non-finite number ${String(value)}`);
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      return undefined;
    case 'object':
      break;
    default:
      throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
  }

  const obj = value as object;
  if (stack.has(obj)) {
    throw new TypeError('canonicalJson: cyclic structure');
  }
  stack.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items = (obj as unknown[]).map((item) => encode(item, stack) ?? 'null');
      return `[${items.join(',')}]`;
    }
    const proto: unknown = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError('canonicalJson: only plain objects and arrays are supported');
    }
    const record = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const encoded = encode(record[key], stack);
      if (encoded !== undefined) {
        parts.push(`${JSON.stringify(key)}:${encoded}`);
      }
    }
    return `{${parts.join(',')}}`;
  } finally {
    stack.delete(obj);
  }
}

/** Serialise plain JSON data canonically. Throws TypeError on anything that is not plain data. */
export function canonicalJson(value: unknown): string {
  const out = encode(value, new Set<object>());
  if (out === undefined) {
    throw new TypeError('canonicalJson: top-level value is undefined');
  }
  return out;
}

/** Byte length of a string's UTF-8 encoding (used for the 2,048-byte bundle budget). */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
