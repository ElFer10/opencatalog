/**
 * View queries over a data source: search, filters, multi-level sort and hierarchical grouping.
 */
import { DataRecord, DataSource, FieldType, Value, formatValue, isEmpty } from "./model";

export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "startsWith"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "empty"
  | "notEmpty";

export const FILTER_OPS: readonly { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: "contains", label: "contains", needsValue: true },
  { op: "notContains", label: "does not contain", needsValue: true },
  { op: "eq", label: "is", needsValue: true },
  { op: "neq", label: "is not", needsValue: true },
  { op: "startsWith", label: "starts with", needsValue: true },
  { op: "gt", label: ">", needsValue: true },
  { op: "gte", label: "≥", needsValue: true },
  { op: "lt", label: "<", needsValue: true },
  { op: "lte", label: "≤", needsValue: true },
  { op: "empty", label: "is empty", needsValue: false },
  { op: "notEmpty", label: "is not empty", needsValue: false },
];

export interface Filter {
  field: string;
  op: FilterOp;
  value?: string;
}

export interface SortKey {
  field: string;
  dir: "asc" | "desc";
}

export interface ViewSpec {
  search: string;
  filters: Filter[];
  filterMode: "all" | "any";
  sort: SortKey[];
  groupBy: string[];
}

export const emptyView = (): ViewSpec => ({ search: "", filters: [], filterMode: "all", sort: [], groupBy: [] });

export interface GroupNode {
  /** Path of group values from the root, joined with "\u001f"; unique per node. */
  key: string;
  field: string;
  value: Value;
  depth: number;
  count: number;
  children: GroupNode[];
  /** Records directly in this group (only on the deepest level). */
  records: DataRecord[];
}

export interface ViewResult {
  records: DataRecord[];
  groups: GroupNode[] | null;
  total: number;
}

// Natural, case-insensitive comparison; falls back gracefully if Intl is unavailable in the host.
const collator: { compare(a: string, b: string): number } = (() => {
  try {
    return new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  } catch {
    return { compare: (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()) };
  }
})();

function fieldType(ds: DataSource, name: string): FieldType {
  return ds.fields.find((f) => f.name === name)?.type ?? "text";
}

function toNumber(v: Value | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Compare two values; empty values always sort last regardless of direction is handled by caller. */
export function compareValues(a: Value | undefined, b: Value | undefined, type: FieldType): number {
  if (type === "number" || type === "boolean") {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na !== null && nb !== null) return na - nb;
  }
  return collator.compare(formatValue(a), formatValue(b));
}

function matchFilter(r: DataRecord, f: Filter, type: FieldType): boolean {
  const v = r.values[f.field];
  const text = formatValue(v).toLocaleLowerCase();
  const needle = (f.value ?? "").toLocaleLowerCase();
  switch (f.op) {
    case "empty":
      return isEmpty(v);
    case "notEmpty":
      return !isEmpty(v);
    case "contains":
      return text.includes(needle);
    case "notContains":
      return !text.includes(needle);
    case "startsWith":
      return text.startsWith(needle);
    case "eq":
    case "neq": {
      const num = type === "number" ? toNumber(v) : null;
      const target = type === "number" ? toNumber(f.value ?? null) : null;
      const same = num !== null && target !== null ? num === target : collator.compare(text, needle) === 0;
      return f.op === "eq" ? same : !same;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (isEmpty(v)) return false;
      const c = compareValues(v, f.value ?? "", type);
      if (f.op === "gt") return c > 0;
      if (f.op === "gte") return c >= 0;
      if (f.op === "lt") return c < 0;
      return c <= 0;
    }
  }
}

export function filterRecords(ds: DataSource, spec: Pick<ViewSpec, "search" | "filters" | "filterMode">): DataRecord[] {
  const terms = spec.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const types = new Map(ds.fields.map((f) => [f.name, f.type] as const));
  const active = spec.filters.filter((f) => f.field && types.has(f.field));
  return ds.records.filter((r) => {
    if (terms.length > 0) {
      const hay = Object.values(r.values).map(formatValue).join("\u0000").toLocaleLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (active.length === 0) return true;
    const test = (f: Filter) => matchFilter(r, f, types.get(f.field) ?? "text");
    return spec.filterMode === "all" ? active.every(test) : active.some(test);
  });
}

export function sortRecords(ds: DataSource, records: readonly DataRecord[], keys: readonly SortKey[]): DataRecord[] {
  const valid = keys.filter((k) => ds.fields.some((f) => f.name === k.field));
  const indexed = records.map((r, i) => ({ r, i }));
  if (valid.length === 0) return records.slice();
  const types = valid.map((k) => fieldType(ds, k.field));
  indexed.sort((x, y) => {
    for (let n = 0; n < valid.length; n++) {
      const k = valid[n]!;
      const a = x.r.values[k.field];
      const b = y.r.values[k.field];
      const ea = isEmpty(a);
      const eb = isEmpty(b);
      if (ea !== eb) return ea ? 1 : -1; // empties last in both directions
      if (ea && eb) continue;
      const c = compareValues(a, b, types[n]!);
      if (c !== 0) return k.dir === "asc" ? c : -c;
    }
    return x.i - y.i; // stable
  });
  return indexed.map((e) => e.r);
}

/** Group already-sorted records; groups keep first-appearance order, so sorting decides group order. */
export function groupRecords(records: readonly DataRecord[], groupBy: readonly string[]): GroupNode[] {
  const build = (recs: readonly DataRecord[], level: number, parentKey: string): GroupNode[] => {
    const field = groupBy[level];
    if (field === undefined) return [];
    const order: string[] = [];
    const buckets = new Map<string, { value: Value; recs: DataRecord[] }>();
    for (const r of recs) {
      const value = r.values[field] ?? null;
      const id = isEmpty(value) ? "" : formatValue(value);
      let b = buckets.get(id);
      if (!b) {
        b = { value: isEmpty(value) ? null : value, recs: [] };
        buckets.set(id, b);
        order.push(id);
      }
      b.recs.push(r);
    }
    return order.map((id) => {
      const b = buckets.get(id)!;
      const key = parentKey === "" ? id : `${parentKey}\u001f${id}`;
      const deepest = level === groupBy.length - 1;
      return {
        key: `${level}:${key}`,
        field,
        value: b.value,
        depth: level,
        count: b.recs.length,
        children: deepest ? [] : build(b.recs, level + 1, key),
        records: deepest ? b.recs : [],
      };
    });
  };
  return build(records, 0, "");
}

export function applyView(ds: DataSource, spec: ViewSpec): ViewResult {
  const groupBy = spec.groupBy.filter((g) => ds.fields.some((f) => f.name === g));
  // Group fields sort first (ascending unless an explicit sort key says otherwise).
  const groupSort: SortKey[] = groupBy.map((g) => spec.sort.find((s) => s.field === g) ?? { field: g, dir: "asc" });
  const rest = spec.sort.filter((s) => !groupBy.includes(s.field));
  const filtered = filterRecords(ds, spec);
  const sorted = sortRecords(ds, filtered, [...groupSort, ...rest]);
  return {
    records: sorted,
    groups: groupBy.length > 0 ? groupRecords(sorted, groupBy) : null,
    total: ds.records.length,
  };
}

/** Flatten groups into display rows, skipping the content of collapsed groups. */
export type DisplayRow = { kind: "group"; group: GroupNode; collapsed: boolean } | { kind: "record"; record: DataRecord; depth: number };

export function flattenView(result: ViewResult, collapsed: ReadonlySet<string>): DisplayRow[] {
  if (!result.groups) return result.records.map((record) => ({ kind: "record", record, depth: 0 }));
  const out: DisplayRow[] = [];
  const walk = (nodes: readonly GroupNode[]) => {
    for (const g of nodes) {
      const isCollapsed = collapsed.has(g.key);
      out.push({ kind: "group", group: g, collapsed: isCollapsed });
      if (isCollapsed) continue;
      walk(g.children);
      for (const record of g.records) out.push({ kind: "record", record, depth: g.depth + 1 });
    }
  };
  walk(result.groups);
  return out;
}

/** All group keys in a result, e.g. for "collapse all". */
export function allGroupKeys(nodes: readonly GroupNode[] | null): string[] {
  if (!nodes) return [];
  const out: string[] = [];
  const walk = (ns: readonly GroupNode[]) => {
    for (const n of ns) {
      out.push(n.key);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Toggle a column in the sort list: none → asc → desc → none. Shift adds as secondary key. */
export function cycleSort(sort: readonly SortKey[], field: string, additive: boolean): SortKey[] {
  const current = sort.find((s) => s.field === field);
  const next: SortKey | null = !current ? { field, dir: "asc" } : current.dir === "asc" ? { field, dir: "desc" } : null;
  if (!additive) return next ? [next] : [];
  const others = sort.filter((s) => s.field !== field);
  return next ? (current ? sort.map((s) => (s.field === field ? next : s)) : [...others, next]) : others;
}
