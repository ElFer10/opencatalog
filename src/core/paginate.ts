/**
 * Pagination planning (pure). Two modes:
 * - Template: a layout block showing one record is repeated in a grid over as many pages as needed.
 * - Flow: records become paragraphs in one threaded story; the document adds pages on overflow.
 */
import { formatFieldValue } from "./format";
import type { Bounds } from "./layout";
import type { FieldLink } from "./links";
import { DataRecord, DataSource, Value, formatValue, isEmpty } from "./model";
import { toDocumentText } from "./sync";

export interface Slot {
  key: string;
  /** Offset of this copy from the template block's position (same page coordinates). */
  dx: number;
  dy: number;
}

export interface TemplatePlan {
  /** pages[0] is the template's page; later entries are pages after it (added when missing). */
  pages: Slot[][];
}

/** All grid positions of a block inside an area, aligned with the block, row by row. */
export function gridPositions(block: Bounds, area: Bounds, gap: number): [number, number][] {
  const w = block[3] - block[1];
  const h = block[2] - block[0];
  if (w <= 0 || h <= 0) return [];
  const stepX = w + gap;
  const stepY = h + gap;
  const eps = 1e-6;
  const firstLeft = block[1] - Math.floor((block[1] - area[1] + eps) / stepX) * stepX;
  const firstTop = block[0] - Math.floor((block[0] - area[0] + eps) / stepY) * stepY;
  const out: [number, number][] = [];
  for (let top = firstTop; top + h <= area[2] + eps; top += stepY) {
    for (let left = firstLeft; left + w <= area[3] + eps; left += stepX) out.push([left - block[1], top - block[0]]);
  }
  return out;
}

export interface TemplateOptions {
  block: Bounds;
  area: Bounds;
  gap: number;
  /** Records in output order. The template block itself becomes the first record. */
  keys: readonly string[];
  /** Keys that must start on a new page (e.g. the first record of each group). */
  breakBefore?: ReadonlySet<string>;
  /** Safety limit. */
  maxPages?: number;
}

export function planTemplatePagination(o: TemplateOptions): TemplatePlan {
  const positions = gridPositions(o.block, o.area, o.gap);
  if (positions.length === 0) throw new Error("The template does not fit inside the page margins");
  const startIdx = positions.findIndex(([dx, dy]) => Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6);
  if (startIdx < 0) throw new Error("The template must sit inside the page margins");
  const maxPages = o.maxPages ?? 1000;
  const pages: Slot[][] = [[]];
  let slot = startIdx;
  for (const key of o.keys) {
    const current = pages[pages.length - 1]!;
    const pageFull = slot >= positions.length;
    const forced = o.breakBefore?.has(key) && current.length > 0;
    if (pageFull || forced) {
      if (pages.length >= maxPages) throw new Error(`Pagination stopped at ${maxPages} pages`);
      pages.push([]);
      slot = 0;
    }
    const [dx, dy] = positions[slot]!;
    pages[pages.length - 1]!.push({ key, dx, dy });
    slot++;
  }
  return { pages };
}

/** Keys that start a new value of `field`, in order (the very first key included). */
export function groupStarts(records: readonly DataRecord[], field: string): Set<string> {
  const out = new Set<string>();
  let prev: string | undefined;
  for (const r of records) {
    const v = formatValue(r.values[field]);
    if (prev === undefined || v !== prev) out.add(r.id);
    prev = v;
  }
  return out;
}

export type FlowItem =
  | { kind: "heading"; level: number; text: string }
  | { kind: "record"; key: string; fields: { link: FieldLink; text: string }[] };

export interface FlowOptions {
  fields: readonly string[];
  /** Group fields; a heading paragraph is written whenever a group value changes. */
  headings?: readonly string[];
}

/** Turn ordered records into flow items (group headings + one item per record). */
export function buildFlow(ds: DataSource, records: readonly DataRecord[], o: FlowOptions): FlowItem[] {
  const defs = new Map(ds.fields.map((f) => [f.name, f] as const));
  const out: FlowItem[] = [];
  const last: (string | undefined)[] = [];
  for (const r of records) {
    (o.headings ?? []).forEach((g, level) => {
      const v: Value | undefined = r.values[g];
      const text = isEmpty(v) ? "" : formatFieldValue(v, defs.get(g), ds);
      if (last[level] !== text) {
        if (text !== "") out.push({ kind: "heading", level, text: toDocumentText(text) });
        last[level] = text;
        last.length = level + 1; // a new parent value restarts the deeper levels
      }
    });
    out.push({
      kind: "record",
      key: r.id,
      fields: o.fields.map((f) => ({ link: { source: ds.id, key: r.id, field: f }, text: toDocumentText(formatFieldValue(r.values[f], defs.get(f), ds)) })),
    });
  }
  return out;
}

/** Paragraph style names applied in flow pagination when the document defines them. */
export const FLOW_STYLES = { heading: (level: number) => `OC Heading ${level + 1}`, record: "OC Record" } as const;
