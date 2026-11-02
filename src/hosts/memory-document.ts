/**
 * An in-memory stand-in for an InDesign document. Used by the unit tests and by the browser
 * preview, and follows the same placement rules as the InDesign adapter.
 * Units are millimetres on a single A4 page with 12 mm margins.
 */
import { Bounds, gridOffsets, retargetEncoded, sampleKeyOf, unionBounds } from "../core/layout";
import { DocumentAdapter, FieldLink, LinkedItem, PlaceResult, RepeatResult, decodeLink, encodeLink } from "../core/links";

export interface Run {
  text: string;
  /** Encoded link when this run is a placed field. */
  link?: string;
}

export interface MemTable {
  header: string[] | null;
  rows: Run[][];
}

export interface MemFrame {
  id: number;
  kind: "text" | "graphic" | "table";
  page: string;
  bounds: Bounds;
  /** Frame-level link label. */
  label?: string;
  runs: Run[];
  image?: string;
  table?: MemTable;
}

export type MemSelection = { frameId: number; offset?: number; more?: number[] } | null;

export type MemRef = { frameId: number; run?: number; row?: number; col?: number };

export const PAGE: Bounds = [0, 0, 297, 210];
export const MARGINS: Bounds = [12, 12, 285, 198];

export class MemoryDocument implements DocumentAdapter<MemRef> {
  frames: MemFrame[] = [];
  selection: MemSelection = null;
  /** Paths that "exist" for image placement; empty = accept every path. */
  existingFiles = new Set<string>();
  undoSteps: string[] = [];
  private nextId = 1;
  onChange: () => void = () => {};

  constructor(readonly name = "Untitled-1") {}

  /** Next free spot down the left margin for a new frame. */
  private nextBounds(height: number, width = 90): Bounds {
    const bottom = this.frames.reduce((m, f) => Math.max(m, f.bounds[2]), MARGINS[0] - 4);
    const top = bottom + 4;
    return [top, MARGINS[1], top + height, MARGINS[1] + width];
  }

  addFrame(kind: "text" | "graphic" | "table", text = "", page = "1", bounds?: Bounds): MemFrame {
    const b = bounds ?? this.nextBounds(kind === "graphic" ? 40 : kind === "table" ? 50 : 18);
    const f: MemFrame = { id: this.nextId++, kind, page, bounds: b, runs: text ? [{ text }] : [] };
    this.frames.push(f);
    this.onChange();
    return f;
  }

  frame(id: number): MemFrame {
    const f = this.frames.find((x) => x.id === id);
    if (!f) throw new Error(`Frame ${id} not found`);
    return f;
  }

  selectedFrames(): MemFrame[] {
    const s = this.selection;
    if (!s) return [];
    return [s.frameId, ...(s.more ?? [])].map((id) => this.frame(id));
  }

  static storyText(f: MemFrame): string {
    return f.runs.map((r) => r.text).join("");
  }

  scan(): LinkedItem<MemRef>[] {
    const out: LinkedItem<MemRef>[] = [];
    for (const f of this.frames) {
      const frameLink = decodeLink(f.label);
      if (frameLink) {
        out.push({ ref: { frameId: f.id }, link: frameLink, kind: f.kind === "graphic" ? "image" : "frame-text", current: f.kind === "graphic" ? f.image ?? "" : MemoryDocument.storyText(f), page: f.page });
        continue;
      }
      f.runs.forEach((r, i) => {
        const link = decodeLink(r.link);
        if (link) out.push({ ref: { frameId: f.id, run: i }, link, kind: "inline-text", current: r.text, page: f.page });
      });
      f.table?.rows.forEach((row, ri) =>
        row.forEach((cell, ci) => {
          const link = decodeLink(cell.link);
          if (link) out.push({ ref: { frameId: f.id, row: ri, col: ci }, link, kind: "cell", current: cell.text, page: f.page });
        }),
      );
    }
    return out;
  }

  transaction(label: string, fn: () => void): void {
    fn();
    this.undoSteps.push(label);
    this.onChange();
  }

  setText(item: LinkedItem<MemRef>, text: string): void {
    const f = this.frame(item.ref.frameId);
    const { run, row, col } = item.ref;
    if (row !== undefined && col !== undefined) {
      const cell = f.table?.rows[row]?.[col];
      if (!cell) throw new Error("Linked cell no longer exists");
      cell.text = text;
    } else if (run === undefined) f.runs = [{ text }];
    else {
      const r = f.runs[run];
      if (!r) throw new Error("Linked text no longer exists");
      r.text = text;
    }
  }

  setImage(item: LinkedItem<MemRef>, path: string): void {
    if (this.existingFiles.size > 0 && !this.existingFiles.has(path)) throw new Error(`File not found: ${path}`);
    this.frame(item.ref.frameId).image = path;
  }

  placeText(fields: { link: FieldLink; text: string }[]): PlaceResult {
    if (fields.length === 0) throw new Error("Nothing to place");
    const sel = this.selection;
    const target = sel ? this.frame(sel.frameId) : null;
    if (target && target.kind !== "text") throw new Error("Select a text frame or a text insertion point to place text fields");
    const runs = (): Run[] =>
      fields.flatMap((f, i) => {
        const r: Run = { text: f.text, link: encodeLink(f.link) };
        return i < fields.length - 1 ? [r, { text: "\r" }] : [r];
      });
    let result: PlaceResult;
    if (target && sel?.offset !== undefined) {
      if (target.label) throw new Error("This frame is linked as a whole; select the frame instead of placing inside it");
      this.insertRuns(target, sel.offset, runs());
      result = { target: "insertion-point" };
    } else if (target) {
      if (fields.length === 1) {
        target.runs = [{ text: fields[0]!.text }];
        target.label = encodeLink(fields[0]!.link);
      } else {
        target.label = undefined;
        target.runs = runs();
      }
      result = { target: "text-frame" };
    } else {
      const f = this.addFrame("text", "", "1", this.nextBounds(fields.length > 1 ? 8 + 6 * fields.length : 12));
      if (fields.length === 1) {
        f.runs = [{ text: fields[0]!.text }];
        f.label = encodeLink(fields[0]!.link);
      } else f.runs = runs();
      this.selection = { frameId: f.id };
      result = { target: "new-frame" };
    }
    this.onChange();
    return result;
  }

  placeImage(link: FieldLink, path: string): PlaceResult {
    const sel = this.selection;
    let f = sel ? this.frame(sel.frameId) : null;
    if (f && f.kind !== "graphic") throw new Error("Select an empty or graphic frame to place an image field");
    const created = !f;
    if (!f) {
      f = this.addFrame("graphic");
      this.selection = { frameId: f.id };
    }
    if (this.existingFiles.size > 0 && !this.existingFiles.has(path)) throw new Error(`File not found: ${path}`);
    f.image = path;
    f.label = encodeLink(link);
    this.onChange();
    return { target: created ? "new-frame" : "graphic-frame" };
  }

  placeTable(header: string[] | null, rows: { link: FieldLink; text: string }[][]): PlaceResult {
    if (rows.length === 0) throw new Error("Nothing to place");
    const sel = this.selection;
    let f = sel ? this.frame(sel.frameId) : null;
    if (f && (f.kind !== "text" || f.label || f.runs.length > 0)) throw new Error("Select an empty text frame, or nothing, to place a table");
    if (!f) f = this.addFrame("table", "", "1", this.nextBounds(8 + 7 * (rows.length + (header ? 1 : 0)), MARGINS[3] - MARGINS[1]));
    f.kind = "table";
    f.table = { header, rows: rows.map((r) => r.map((c) => ({ text: c.text, link: encodeLink(c.link) }))) };
    this.selection = { frameId: f.id };
    this.onChange();
    return { target: "table" };
  }

  repeatSelection(sourceId: string, keys: string[], gap: number): RepeatResult {
    const frames = this.selectedFrames();
    if (frames.length === 0) throw new Error("Select the frames that show one record first");
    const links: FieldLink[] = [];
    for (const f of frames) {
      const l = decodeLink(f.label);
      if (l) links.push(l);
      for (const r of f.runs) { const x = decodeLink(r.link); if (x) links.push(x); }
      for (const row of f.table?.rows ?? []) for (const c of row) { const x = decodeLink(c.link); if (x) links.push(x); }
    }
    const sampleKey = sampleKeyOf(links, sourceId);
    const targets = keys.filter((k) => k !== sampleKey);
    const block = unionBounds(frames.map((f) => f.bounds));
    const offsets = gridOffsets(block, MARGINS, targets.length, gap);
    const placed: string[] = [];
    targets.slice(0, offsets.length).forEach((key, i) => {
      const [dx, dy] = offsets[i]!;
      for (const f of frames) {
        const copy: MemFrame = JSON.parse(JSON.stringify(f));
        copy.id = this.nextId++;
        copy.bounds = [f.bounds[0] + dy, f.bounds[1] + dx, f.bounds[2] + dy, f.bounds[3] + dx];
        if (copy.label) copy.label = retargetEncoded(copy.label, key);
        copy.runs = copy.runs.map((r) => (r.link ? { ...r, link: retargetEncoded(r.link, key) } : r));
        if (copy.table) copy.table.rows = copy.table.rows.map((row) => row.map((c) => (c.link ? { ...c, link: retargetEncoded(c.link, key) } : c)));
        this.frames.push(copy);
      }
      placed.push(key);
    });
    this.onChange();
    return { sampleKey, placed, notPlaced: targets.slice(offsets.length) };
  }

  reveal(item: LinkedItem<MemRef>): void {
    this.selection = { frameId: item.ref.frameId };
    this.onChange();
  }

  /** Simulate a user typing over a linked field, frame or cell. */
  editText(ref: MemRef, text: string): void {
    this.setText({ ref, link: { source: "", key: "", field: "" }, kind: "inline-text", current: "" }, text);
    this.onChange();
  }

  private insertRuns(f: MemFrame, offset: number, add: Run[]): void {
    let pos = 0;
    for (let i = 0; i < f.runs.length; i++) {
      const r = f.runs[i]!;
      if (offset <= pos + r.text.length) {
        if (r.link && offset > pos && offset < pos + r.text.length) throw new Error("Cannot place a field inside another field");
        const cut = offset - pos;
        const before: Run[] = cut > 0 ? [{ ...r, text: r.text.slice(0, cut) }] : [];
        const after: Run[] = cut < r.text.length ? [{ ...r, text: r.text.slice(cut) }] : [];
        f.runs.splice(i, 1, ...before, ...add, ...after);
        return;
      }
      pos += r.text.length;
    }
    f.runs.push(...add);
  }
}
