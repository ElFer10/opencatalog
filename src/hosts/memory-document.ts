/**
 * An in-memory stand-in for an InDesign document. Used by the unit tests and by the browser
 * preview, and follows the same placement rules as the InDesign adapter.
 */
import { DocumentAdapter, FieldLink, LinkedItem, PlaceResult, decodeLink, encodeLink } from "../core/links";

export interface Run {
  text: string;
  /** Encoded link when this run is a placed field. */
  link?: string;
}

export interface MemFrame {
  id: number;
  kind: "text" | "graphic";
  page: string;
  /** Frame-level link label. */
  label?: string;
  runs: Run[];
  image?: string;
}

export type MemSelection = { frameId: number; offset?: number } | null;

export type MemRef = { frameId: number; run?: number };

export class MemoryDocument implements DocumentAdapter<MemRef> {
  frames: MemFrame[] = [];
  selection: MemSelection = null;
  /** Paths that "exist" for image placement; empty = accept every path. */
  existingFiles = new Set<string>();
  undoSteps: string[] = [];
  private nextId = 1;
  onChange: () => void = () => {};

  constructor(readonly name = "Untitled-1") {}

  addFrame(kind: "text" | "graphic", text = "", page = "1"): MemFrame {
    const f: MemFrame = { id: this.nextId++, kind, page, runs: text ? [{ text }] : [] };
    this.frames.push(f);
    this.onChange();
    return f;
  }

  frame(id: number): MemFrame {
    const f = this.frames.find((x) => x.id === id);
    if (!f) throw new Error(`Frame ${id} not found`);
    return f;
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
    if (item.ref.run === undefined) f.runs = [{ text }];
    else {
      const run = f.runs[item.ref.run];
      if (!run) throw new Error("Linked text no longer exists");
      run.text = text;
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
      const f = this.addFrame("text");
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

  reveal(item: LinkedItem<MemRef>): void {
    this.selection = { frameId: item.ref.frameId };
    this.onChange();
  }

  /** Simulate a user typing over a linked inline field or frame. */
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
