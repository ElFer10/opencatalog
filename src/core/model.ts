/**
 * Core data model: a data source is a list of records sharing a set of fields.
 * This module has no dependency on InDesign so it can be unit-tested anywhere.
 */

export type FieldType = "text" | "number" | "date" | "boolean" | "image";

export type Value = string | number | boolean | null;

export interface FieldDef {
  name: string;
  type: FieldType;
}

export interface DataRecord {
  /** Stable identity: the key field value when there is one, otherwise the row number. */
  id: string;
  values: Record<string, Value>;
}

export type SourceKind = "csv" | "xlsx" | "json";

export interface DataSource {
  id: string;
  name: string;
  kind: SourceKind;
  fields: FieldDef[];
  records: DataRecord[];
  /** Field whose values uniquely identify each record, if any. */
  keyField: string | null;
  /** ISO timestamp of the last load. */
  loadedAt: string;
}

export type RawRow = Record<string, Value>;

export interface CreateSourceOptions {
  id?: string;
  /** Explicit column order; defaults to first-seen order across rows. */
  columns?: string[];
  /** Force a key field. `null` disables key detection. */
  keyField?: string | null;
  /** Field type overrides by field name. */
  types?: Record<string, FieldType>;
  now?: Date;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|tiff?|psd|ai|eps|pdf|svg|webp|heic)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const KEY_NAME = /^(id|key|sku|ean|gtin|code|codigo|código|art(icle)?([ _-]?(no|nr|number))?|artikel(nummer|nr)?|ref(erence)?|product[ _-]?id)$/i;

/** Columns in first-seen order across all rows. */
export function collectColumns(rows: readonly RawRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

export function isEmpty(v: Value | undefined): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Infer a field type from its non-empty values. */
export function inferType(values: readonly (Value | undefined)[]): FieldType {
  const present = values.filter((v): v is Exclude<Value, null> => !isEmpty(v));
  if (present.length === 0) return "text";
  if (present.every((v) => typeof v === "boolean")) return "boolean";
  if (present.every((v) => typeof v === "number")) return "number";
  if (present.every((v) => typeof v === "string" && ISO_DATE.test(v))) return "date";
  if (present.every((v) => typeof v === "string" && IMAGE_EXT.test(v.trim()))) return "image";
  return "text";
}

/** Pick a column whose values are all present and unique; prefer key-like names. */
export function detectKeyField(columns: readonly string[], rows: readonly RawRow[]): string | null {
  if (rows.length === 0) return null;
  const unique = columns.filter((c) => {
    const seen = new Set<string>();
    for (const r of rows) {
      const v = r[c];
      if (isEmpty(v)) return false;
      const s = String(v);
      if (seen.has(s)) return false;
      seen.add(s);
    }
    return true;
  });
  return unique.find((c) => KEY_NAME.test(c.trim())) ?? unique[0] ?? null;
}

export function createDataSource(
  name: string,
  kind: SourceKind,
  rows: readonly RawRow[],
  opts: CreateSourceOptions = {},
): DataSource {
  const columns = opts.columns ?? collectColumns(rows);
  const fields: FieldDef[] = columns.map((c) => ({
    name: c,
    type: opts.types?.[c] ?? inferType(rows.map((r) => r[c])),
  }));
  const keyField = opts.keyField === undefined ? detectKeyField(columns, rows) : opts.keyField;
  if (keyField !== null && !columns.includes(keyField)) {
    throw new Error(`Key field "${keyField}" is not a column of "${name}"`);
  }
  const records: DataRecord[] = rows.map((r, i) => {
    const values: Record<string, Value> = {};
    for (const c of columns) values[c] = r[c] ?? null;
    const id = keyField !== null && !isEmpty(values[keyField]) ? String(values[keyField]) : `#${i + 1}`;
    return { id, values };
  });
  return {
    id: opts.id ?? `${kind}:${name}`,
    name,
    kind,
    fields,
    records,
    keyField,
    loadedAt: (opts.now ?? new Date()).toISOString(),
  };
}

/** Change the key field and recompute record ids. Throws if the field is not unique. */
export function withKeyField(ds: DataSource, keyField: string | null): DataSource {
  if (keyField !== null) {
    if (!ds.fields.some((f) => f.name === keyField)) throw new Error(`Unknown field "${keyField}"`);
    const seen = new Set<string>();
    for (const r of ds.records) {
      const v = r.values[keyField];
      if (isEmpty(v)) throw new Error(`Field "${keyField}" has empty values and cannot be the key`);
      const s = String(v);
      if (seen.has(s)) throw new Error(`Field "${keyField}" has duplicate value "${s}"`);
      seen.add(s);
    }
  }
  return {
    ...ds,
    keyField,
    records: ds.records.map((r, i) => ({
      ...r,
      id: keyField !== null ? String(r.values[keyField]) : `#${i + 1}`,
    })),
  };
}

/** Display text for a value, independent of locale-specific formatting (phase 2). */
export function formatValue(v: Value | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}
