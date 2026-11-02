import type { RawRow, Value } from "../core/model";
import { collectColumns } from "../core/model";
import type { ParsedTable } from "./table";

/**
 * Accepts an array of objects, or an object holding such an array (the first array property,
 * or the one named by `path`, e.g. "data.products"). Nested objects become dotted columns
 * ("price.amount"); arrays of scalars are joined with ", "; other arrays are kept as JSON text.
 */
export function parseJson(text: string, opts: { path?: string } = {}): ParsedTable {
  const root: unknown = JSON.parse(text);
  const list = findRecords(root, opts.path);
  const rows: RawRow[] = list.map((item) => {
    const row: RawRow = {};
    if (item !== null && typeof item === "object" && !Array.isArray(item)) flatten(item as Record<string, unknown>, "", row);
    else row["value"] = toValue(item);
    return row;
  });
  return { columns: collectColumns(rows), rows };
}

function findRecords(root: unknown, path?: string): unknown[] {
  if (path) {
    let cur: unknown = root;
    for (const part of path.split(".").filter(Boolean)) {
      if (cur === null || typeof cur !== "object") throw new Error(`JSON path "${path}" not found`);
      cur = (cur as Record<string, unknown>)[part];
    }
    if (!Array.isArray(cur)) throw new Error(`JSON path "${path}" is not an array`);
    return cur;
  }
  if (Array.isArray(root)) return root;
  if (root !== null && typeof root === "object") {
    // Breadth-first search for the first array of objects.
    const queue: unknown[] = [root];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === null || typeof cur !== "object") continue;
      for (const v of Object.values(cur as Record<string, unknown>)) {
        if (Array.isArray(v) && v.some((x) => x !== null && typeof x === "object" && !Array.isArray(x))) return v;
        if (v !== null && typeof v === "object" && !Array.isArray(v)) queue.push(v);
      }
    }
    return [root];
  }
  throw new Error("JSON does not contain records");
}

function toValue(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

function flatten(obj: Record<string, unknown>, prefix: string, out: RawRow): void {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else if (Array.isArray(v) && v.every((x) => x === null || ["string", "number", "boolean"].includes(typeof x)))
      out[key] = v.filter((x) => x !== null).join(", ");
    else out[key] = toValue(v);
  }
}
