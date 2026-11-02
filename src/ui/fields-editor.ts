/** Field options: visibility, formats and computed fields. */
import { ComputedDef, ComputedError, DataSource, FUNCTION_NAMES, FieldDef, FieldFormat, hasFormat } from "../core";
import { add, h, select } from "./dom";

export interface FieldsEditorProps {
  source: DataSource;
  hidden: ReadonlySet<string>;
  editing: string | null;
  computed: ComputedDef[];
  errors: ComputedError[];
  onToggleHidden(field: string, visible: boolean): void;
  onEdit(field: string | null): void;
  onFormat(field: string, format: FieldFormat | undefined): void;
  onComputed(defs: ComputedDef[]): void;
}

const THOUSANDS = [
  { value: "", label: "none" },
  { value: " ", label: "space (1 000)" },
  { value: " ", label: "thin space" },
  { value: ".", label: "point (1.000)" },
  { value: ",", label: "comma (1,000)" },
  { value: "'", label: "apostrophe (1'000)" },
];

function formatEditor(field: FieldDef, onFormat: (f: FieldFormat | undefined) => void): HTMLElement {
  const fmt: FieldFormat = { ...(field.format ?? {}) };
  const commit = () => {
    const clean: FieldFormat = {};
    for (const [k, v] of Object.entries(fmt)) if (v !== undefined && v !== "") (clean as Record<string, unknown>)[k] = v;
    onFormat(hasFormat(clean) ? clean : undefined);
  };
  const text = (key: "prefix" | "suffix" | "empty" | "date" | "locale", placeholder: string, width = 70) => {
    const input = h("input", { class: "oc-input", type: "text", value: fmt[key] ?? "", placeholder, style: `width:${width}px` });
    input.addEventListener("change", () => {
      fmt[key] = input.value === "" ? undefined : input.value;
      commit();
    });
    return input;
  };
  const decimals = h("input", { class: "oc-input", type: "number", min: "0", max: "10", value: fmt.decimals ?? "", placeholder: "auto", style: "width:56px" });
  decimals.addEventListener("change", () => {
    fmt.decimals = decimals.value === "" ? undefined : Math.max(0, Math.min(10, Number(decimals.value)));
    commit();
  });
  const isNumber = field.type === "number";
  const isDate = field.type === "date";
  return h("div", { class: "oc-format" },
    h("div", { class: "oc-row" },
      h("span", { class: "oc-label" }, "Prefix"), text("prefix", "e.g. €"),
      h("span", { class: "oc-label" }, "Suffix"), text("suffix", "e.g. kr"),
      h("span", { class: "oc-label" }, "If empty"), text("empty", "e.g. —"),
    ),
    h("div", { class: "oc-row" },
      h("span", { class: "oc-label" }, "Case"),
      select([{ value: "", label: "as is" }, { value: "upper", label: "UPPER" }, { value: "lower", label: "lower" }, { value: "title", label: "Title Case" }], fmt.case ?? "", (v) => {
        fmt.case = v === "" ? undefined : (v as FieldFormat["case"]);
        commit();
      }),
      isNumber ? h("span", { class: "oc-label" }, "Decimals") : null,
      isNumber ? decimals : null,
      isNumber ? h("span", { class: "oc-label" }, "Thousands") : null,
      isNumber ? select(THOUSANDS, fmt.thousands ?? "", (v) => { fmt.thousands = v === "" ? undefined : v; commit(); }) : null,
      isDate ? h("span", { class: "oc-label", title: "YYYY YY MMMM MMM MM M DD D HH mm" }, "Date") : null,
      isDate ? text("date", "DD.MM.YYYY", 110) : null,
      isDate ? h("span", { class: "oc-label" }, "Locale") : null,
      isDate ? text("locale", "sv-SE", 60) : null,
      h("button", { class: "oc-btn oc-small", on: { click: () => onFormat(undefined) } }, "Reset"),
    ),
  );
}

export function renderFieldsEditor(p: FieldsEditorProps): HTMLElement {
  const box = h("div", { class: "oc-fieldlist" });
  for (const f of p.source.fields) {
    const err = p.errors.find((e) => e.field === f.name);
    const row = h("div", { class: "oc-row oc-fieldrow" },
      h("input", { type: "checkbox", checked: !p.hidden.has(f.name), on: { change: (e) => p.onToggleHidden(f.name, (e.target as HTMLInputElement).checked) } }),
      h("span", { class: "oc-fieldname" }, f.name),
      h("span", { class: "oc-muted" }, f.expression ? `computed · ${f.type}` : f.type),
      hasFormat(f.format) ? h("span", { class: "oc-tag" }, "formatted") : null,
      h("button", { class: `oc-btn oc-small${p.editing === f.name ? " oc-on" : ""}`, on: { click: () => p.onEdit(p.editing === f.name ? null : f.name) } }, "Format…"),
      err ? h("span", { class: "oc-error", title: err.message }, `⚠ ${err.count ? `${err.count} errors` : "invalid"}`) : null,
    );
    box.appendChild(row);
    if (p.editing === f.name) box.appendChild(formatEditor(f, (fmt) => p.onFormat(f.name, fmt)));
  }

  // Computed fields
  const list = h("div", { class: "oc-computed" }, h("div", { class: "oc-subtitle" }, "Computed fields"));
  p.computed.forEach((def, i) => {
    const expr = h("input", { class: "oc-input oc-expr", type: "text", value: def.expression });
    expr.addEventListener("change", () => p.onComputed(p.computed.map((d, j) => (j === i ? { ...d, expression: expr.value } : d))));
    const err = p.errors.find((e) => e.field === def.name);
    add(list,
      h("div", { class: "oc-row" },
        h("span", { class: "oc-fieldname" }, def.name), h("span", { class: "oc-muted" }, "="), expr,
        h("button", { class: "oc-x", title: "Delete computed field", on: { click: () => p.onComputed(p.computed.filter((_, j) => j !== i)) } }, "×"),
      ),
      err ? h("div", { class: "oc-row oc-error" }, err.message) : null,
    );
  });
  const name = h("input", { class: "oc-input", type: "text", placeholder: "Name", style: "width:100px" });
  const expr = h("input", { class: "oc-input oc-expr", type: "text", placeholder: '{Price} * 1.25   or   {Name} & " " & {Unit}' });
  const addBtn = h("button", { class: "oc-btn oc-small", on: { click: () => {
    if (!name.value.trim() || !expr.value.trim()) return;
    p.onComputed([...p.computed, { name: name.value.trim(), expression: expr.value.trim() }]);
  } } }, "+ Add");
  add(list,
    h("div", { class: "oc-row" }, name, h("span", { class: "oc-muted" }, "="), expr, addBtn),
    h("div", { class: "oc-row oc-muted oc-help" },
      `Fields in {braces}. Operators + - * / & (join text) = <> < > and or not. Functions: ${FUNCTION_NAMES.join(", ")}.`),
  );
  box.appendChild(list);
  return box;
}
