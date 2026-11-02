/**
 * Scripting: run JavaScript in the panel against an `oc` API (records, selection, updates,
 * pagination, PDF export). Scripts are saved per data source. In InDesign, `oc.indesign` is the
 * UXP InDesign DOM (`require("indesign")`) for anything the API does not cover.
 */
import { add, h, select } from "./dom";

export interface ScriptHost {
  api(log: (...args: unknown[]) => void): Record<string, unknown>;
}

export async function runScript(code: string, host: ScriptHost, log: (line: string) => void): Promise<void> {
  const print = (...args: unknown[]) =>
    log(args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" "));
  const oc = host.api(print);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("oc", `"use strict"; return (async () => {\n${code}\n})();`) as (oc: unknown) => Promise<unknown>;
  const result = await fn(oc);
  if (result !== undefined) print("→", result);
}

export const EXAMPLE_SCRIPT = `// oc.records() → records in list order; oc.fields → field names
const cheap = oc.records().filter(r => Number(r.values["Price"]) < 5);
oc.log(cheap.length, "cheap records");
oc.select(cheap.map(r => r.id));
// await oc.updateDocument();          // all linked fields
// await oc.exportPdf("/Users/me/Desktop/catalogue.pdf");`;

export interface ScriptBoxProps {
  scripts: { name: string; code: string }[];
  /** Code being edited (kept by the panel across re-renders). */
  draft: { name: string; code: string } | null;
  onDraft(name: string, code: string): void;
  output: string[];
  onRun(code: string): void;
  onSave(name: string, code: string): void;
  onDelete(name: string): void;
}

export function renderScriptBox(p: ScriptBoxProps): HTMLElement {
  const start = p.draft ?? p.scripts[0] ?? { name: "", code: EXAMPLE_SCRIPT };
  const area = h("textarea", { class: "oc-input oc-script", rows: "8", spellcheck: "false" }, start.code);
  const name = h("input", { class: "oc-input", type: "text", placeholder: "script name", value: start.name, style: "width:120px" });
  const keep = () => p.onDraft(name.value, area.value);
  area.addEventListener("input", keep);
  name.addEventListener("input", keep);
  const box = h("div", { class: "oc-scriptbox" });
  add(box,
    h("div", { class: "oc-row" },
      p.scripts.length
        ? select(p.scripts.map((s) => ({ value: s.name, label: s.name })), p.scripts.some((x) => x.name === start.name) ? start.name : p.scripts[0]!.name, (v) => {
            const s = p.scripts.find((x) => x.name === v);
            if (s) { area.value = s.code; name.value = s.name; keep(); }
          })
        : h("span", { class: "oc-muted" }, "No saved scripts"),
      name,
      h("button", { class: "oc-btn oc-small", on: { click: () => name.value.trim() && p.onSave(name.value.trim(), area.value) } }, "Save"),
      h("button", { class: "oc-btn oc-small", on: { click: () => name.value.trim() && p.onDelete(name.value.trim()) } }, "Delete"),
    ),
    area,
    h("div", { class: "oc-row" },
      h("button", { class: "oc-btn oc-primary", on: { click: () => { keep(); p.onRun(area.value); } } }, "Run"),
      h("span", { class: "oc-muted oc-help" }, "API: oc.records(), oc.all(), oc.fields, oc.selected(), oc.select(ids), oc.setVersion(v), oc.versions, await oc.updateDocument(ids?), await oc.paginate(), await oc.exportPdf(path, preset?), oc.document, oc.indesign, oc.log()"),
    ),
    h("pre", { class: "oc-output" }, p.output.slice(-200).join("\n")),
  );
  return box;
}
