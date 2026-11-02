/** Compare two loads of the same data source: new, changed and deleted records. */
import { DataSource, formatValue } from "./model";

export interface SourceDiff {
  added: string[];
  removed: string[];
  /** Record id → names of fields whose value changed. */
  changed: Map<string, string[]>;
  /** Fields that appeared or disappeared. */
  addedFields: string[];
  removedFields: string[];
}

export function diffSources(before: DataSource, after: DataSource): SourceDiff {
  const dataFields = (ds: DataSource) => ds.fields.filter((f) => !f.expression).map((f) => f.name);
  const fb = dataFields(before);
  const fa = dataFields(after);
  const common = fa.filter((f) => fb.includes(f));
  const old = new Map(before.records.map((r) => [r.id, r] as const));
  const seen = new Set<string>();
  const diff: SourceDiff = {
    added: [],
    removed: [],
    changed: new Map(),
    addedFields: fa.filter((f) => !fb.includes(f)),
    removedFields: fb.filter((f) => !fa.includes(f)),
  };
  for (const r of after.records) {
    seen.add(r.id);
    const o = old.get(r.id);
    if (!o) {
      diff.added.push(r.id);
      continue;
    }
    const fields = common.filter((f) => formatValue(o.values[f]) !== formatValue(r.values[f]));
    if (fields.length) diff.changed.set(r.id, fields);
  }
  for (const r of before.records) if (!seen.has(r.id)) diff.removed.push(r.id);
  return diff;
}

export function isEmptyDiff(d: SourceDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.size === 0 && d.addedFields.length === 0 && d.removedFields.length === 0;
}
