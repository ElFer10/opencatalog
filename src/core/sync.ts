/**
 * Synchronization between data sources and linked document content.
 * Planning is pure (testable); applying goes through a DocumentAdapter.
 */
import { ImageContext, resolveImage, samePath } from "./images";
import type { DocumentAdapter, LinkedItem } from "./links";
import { formatFieldValue, parseFieldText } from "./format";
import { DataSource, Value, formatValue, getRecord, setRecordValue } from "./model";

export interface SourceContext {
  source: DataSource;
  images: ImageContext;
}

export interface Issue<Ref = unknown> {
  item: LinkedItem<Ref>;
  message: string;
}

export interface DocChange<Ref = unknown> {
  item: LinkedItem<Ref>;
  /** New text, or the absolute image path. */
  value: string;
}

export interface DocumentPlan<Ref = unknown> {
  changes: DocChange<Ref>[];
  errors: Issue<Ref>[];
  unchanged: number;
  /** Links to sources that are not loaded in the panel. */
  otherSources: number;
}

export interface UpdateScope {
  /** Only update links to these record ids (e.g. the panel selection). */
  keys?: ReadonlySet<string>;
}

export function planUpdateDocument<Ref>(
  items: readonly LinkedItem<Ref>[],
  contexts: ReadonlyMap<string, SourceContext>,
  scope: UpdateScope = {},
): DocumentPlan<Ref> {
  const plan: DocumentPlan<Ref> = { changes: [], errors: [], unchanged: 0, otherSources: 0 };
  for (const item of items) {
    const ctx = contexts.get(item.link.source);
    if (!ctx) {
      plan.otherSources++;
      continue;
    }
    if (scope.keys && !scope.keys.has(item.link.key)) continue;
    const { source } = ctx;
    const record = getRecord(source, item.link.key);
    if (!record) {
      plan.errors.push({ item, message: `Record "${item.link.key}" no longer exists in ${source.name}` });
      continue;
    }
    const fieldDef = source.fields.find((f) => f.name === item.link.field);
    if (!fieldDef) {
      plan.errors.push({ item, message: `Field "${item.link.field}" no longer exists in ${source.name}` });
      continue;
    }
    const value = record.values[item.link.field];
    if (item.kind === "image") {
      const res = resolveImage(formatValue(value), ctx.images);
      if (!res.ok) {
        plan.errors.push({ item, message: `${item.link.key} · ${item.link.field}: ${res.error}` });
        continue;
      }
      if (samePath(item.current, res.path)) plan.unchanged++;
      else plan.changes.push({ item, value: res.path });
      continue;
    }
    const text = formatFieldValue(value, fieldDef, source);
    if (normalizeText(item.current) === normalizeText(text)) plan.unchanged++;
    else plan.changes.push({ item, value: text });
  }
  return plan;
}

/** InDesign uses \r for paragraph breaks; compare text independent of line-break style. */
export function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/** Convert data text to InDesign paragraph breaks. */
export function toDocumentText(s: string): string {
  return s.replace(/\r\n?|\n/g, "\r");
}

export interface ApplyResult<Ref = unknown> {
  updated: number;
  errors: Issue<Ref>[];
}

export function applyDocumentPlan<Ref>(doc: DocumentAdapter<Ref>, plan: DocumentPlan<Ref>, label = "OpenCatalog: Update document"): ApplyResult<Ref> {
  const result: ApplyResult<Ref> = { updated: 0, errors: [...plan.errors] };
  if (plan.changes.length === 0) return result;
  doc.transaction(label, () => {
    for (const c of plan.changes) {
      try {
        if (c.item.kind === "image") doc.setImage(c.item, c.value);
        else doc.setText(c.item, toDocumentText(c.value));
        result.updated++;
      } catch (e) {
        result.errors.push({ item: c.item, message: `${c.item.link.key} · ${c.item.link.field}: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  });
  return result;
}

export interface PanelEdit<Ref = unknown> {
  recordId: string;
  field: string;
  from: Value;
  to: Value;
  items: LinkedItem<Ref>[];
}

export interface PanelPlan<Ref = unknown> {
  edits: PanelEdit<Ref>[];
  conflicts: Issue<Ref>[];
  unchanged: number;
}

/** Find text edited in the document that differs from the data (document → panel). */
export function planUpdatePanel<Ref>(items: readonly LinkedItem<Ref>[], source: DataSource, scope: UpdateScope = {}): PanelPlan<Ref> {
  const plan: PanelPlan<Ref> = { edits: [], conflicts: [], unchanged: 0 };
  const byCell = new Map<string, PanelEdit<Ref>>();
  const defs = new Map(source.fields.map((f) => [f.name, f] as const));
  for (const item of items) {
    if (item.link.source !== source.id || item.kind === "image") continue;
    if (scope.keys && !scope.keys.has(item.link.key)) continue;
    const record = getRecord(source, item.link.key);
    const def = defs.get(item.link.field);
    if (!record || !def) continue; // reported by Update Document
    const current = normalizeText(item.current);
    const dataText = normalizeText(formatFieldValue(record.values[item.link.field], def, source));
    if (current === dataText) {
      plan.unchanged++;
      continue;
    }
    if (def.expression) {
      plan.conflicts.push({ item, message: `${item.link.key} · ${item.link.field} is a computed field and cannot be edited in the document` });
      continue;
    }
    const parsed = parseFieldText(current, def, source);
    if (parsed === undefined) {
      plan.conflicts.push({ item, message: `"${current}" is not a valid ${def.type} for ${item.link.key} · ${item.link.field}` });
      continue;
    }
    const cell = `${item.link.key}\u001f${item.link.field}`;
    const existing = byCell.get(cell);
    if (existing) {
      if (formatValue(existing.to) !== formatValue(parsed)) {
        plan.conflicts.push({ item, message: `${item.link.key} · ${item.link.field} was edited differently in two places` });
        plan.edits = plan.edits.filter((e) => e !== existing);
        byCell.set(cell, { ...existing, items: [] });
      } else existing.items.push(item);
      continue;
    }
    const edit: PanelEdit<Ref> = { recordId: item.link.key, field: item.link.field, from: record.values[item.link.field] ?? null, to: parsed, items: [item] };
    byCell.set(cell, edit);
    plan.edits.push(edit);
  }
  return plan;
}

export function applyPanelPlan(source: DataSource, plan: PanelPlan): DataSource {
  return plan.edits.reduce((ds, e) => setRecordValue(ds, e.recordId, e.field, e.to), source);
}

/** Number of placed links per record id for one source. */
export function placeCounts(items: readonly LinkedItem[], sourceId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const i of items) if (i.link.source === sourceId) counts.set(i.link.key, (counts.get(i.link.key) ?? 0) + 1);
  return counts;
}

/** Image URLs that Update Document or placing will need for the given links. */
export function imageUrlsFor(items: readonly LinkedItem[], contexts: ReadonlyMap<string, SourceContext>): string[] {
  const urls = new Set<string>();
  for (const i of items) {
    if (i.kind !== "image") continue;
    const ctx = contexts.get(i.link.source);
    const v = ctx ? getRecord(ctx.source, i.link.key)?.values[i.link.field] : undefined;
    if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) urls.add(v.trim());
  }
  return [...urls];
}
