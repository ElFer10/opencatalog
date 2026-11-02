/**
 * The OpenCatalog data panel.
 * Phase 0: load a source and browse it (search, filters, sort, grouping, field visibility).
 * Phase 1: select records, place fields in the document, Update Document / Update Panel,
 *          placement counts and an error report.
 */
import {
  DataSource,
  DisplayRow,
  DocumentAdapter,
  FILTER_OPS,
  Filter,
  FilterOp,
  Issue,
  LinkedItem,
  SourceContext,
  Value,
  ViewSpec,
  allGroupKeys,
  applyDocumentPlan,
  applyPanelPlan,
  applyView,
  cycleSort,
  dirname,
  emptyView,
  flattenView,
  formatForDocument,
  formatValue,
  getRecord,
  placeCounts,
  planUpdateDocument,
  planUpdatePanel,
  resolveImage,
  toDocumentText,
  withKeyField,
} from "../core";
import type { Host, PickedFile } from "../hosts/host";
import { SUPPORTED_EXTENSIONS, loadFromBytes, toCsv } from "../providers";
import { add, clear, h, select } from "./dom";

const PAGE = 300;
const COL_WIDTH = 132;

type PlacedFilter = "all" | "placed" | "unplaced";

interface SourcePrefs {
  view: ViewSpec;
  hidden: string[];
  keyField?: string | null;
  decimalSeparator?: "." | ",";
  imageFolder?: string;
}

interface Settings {
  last?: { token: string; name: string; sheet?: string };
  sources: Record<string, SourcePrefs>;
}

interface Report {
  title: string;
  ok: boolean;
  issues: Issue[];
}

function readSettings(raw: unknown): Settings {
  if (raw && typeof raw === "object" && "sources" in raw) return raw as Settings;
  return { sources: {} };
}

const cellKey = (id: string, field: string) => `${id}\u001f${field}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export class Panel {
  private source: DataSource | null = null;
  private file: PickedFile | null = null;
  private sheets: string[] = [];
  private sheet: string | undefined;
  private view: ViewSpec = emptyView();
  private hidden = new Set<string>();
  private collapsed = new Set<string>();
  private limit = PAGE;
  private showFilters = false;
  private showFields = false;
  private message: { text: string; error: boolean } | null = null;
  private settings: Settings;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  // phase 1 state
  private selected = new Set<string>();
  private anchor: string | null = null;
  private counts: Map<string, number> | null = null;
  private placedFilter: PlacedFilter = "all";
  private placeField = "";
  private report: Report | null = null;
  /** Values changed by Update Panel and not yet saved, by record/field. */
  private edited = new Map<string, Value>();

  private readonly toolbar = h("div", { class: "oc-toolbar" });
  private readonly searchInput = h("input", {
    class: "oc-search",
    type: "text",
    placeholder: "Search all fields…",
    on: { input: () => this.onSearch() },
  });
  private readonly controls = h("div", { class: "oc-controls" });
  private readonly filterBox = h("div", { class: "oc-filters" });
  private readonly fieldsBox = h("div", { class: "oc-fields" });
  private readonly docBar = h("div", { class: "oc-docbar" });
  private readonly reportBox = h("div", { class: "oc-report" });
  private readonly grid = h("div", { class: "oc-grid" });
  private readonly status = h("div", { class: "oc-status" });

  constructor(private readonly root: HTMLElement, private readonly host: Host) {
    this.settings = readSettings(host.loadSettings());
    clear(root);
    root.appendChild(
      h("div", { class: "oc-panel" },
        this.toolbar, h("div", { class: "oc-searchrow" }, this.searchInput), this.controls, this.filterBox, this.fieldsBox,
        this.docBar, this.reportBox, this.grid, this.status),
    );
    this.renderAll();
  }

  // ---------- loading ----------

  /** Reopen the last file, if the host can still read it. */
  async restore(): Promise<void> {
    const last = this.settings.last;
    if (!last) return;
    const file = await this.host.reread(last.token);
    if (file) this.openPicked(file, last.sheet);
  }

  async pick(): Promise<void> {
    try {
      const file = await this.host.pickFile(SUPPORTED_EXTENSIONS);
      if (file) this.openPicked(file);
    } catch (e) {
      this.fail(e);
    }
  }

  async reload(): Promise<void> {
    if (!this.file?.token) return;
    if (this.edited.size > 0) {
      this.message = { text: `Reloading discarded ${plural(this.edited.size, "unsaved edit")}.`, error: false };
    }
    const file = await this.host.reread(this.file.token);
    if (!file) return this.fail(new Error("The file can no longer be read. Open it again."));
    this.openPicked(file, this.sheet, true);
  }

  openPicked(file: PickedFile, sheet?: string, keepState = false): void {
    try {
      const { source, sheets } = loadFromBytes(file.name, file.bytes, { sheet });
      this.file = file;
      this.sheets = sheets ?? [];
      this.sheet = sheets ? sheet ?? sheets[0] : undefined;
      const prefs = this.settings.sources[source.id];
      let ds = source;
      if (prefs?.keyField !== undefined && prefs.keyField !== source.keyField) {
        try {
          ds = withKeyField(source, prefs.keyField);
        } catch {
          /* stored key no longer valid; keep detected key */
        }
      }
      if (prefs?.decimalSeparator) ds = { ...ds, decimalSeparator: prefs.decimalSeparator };
      this.source = ds;
      this.edited.clear();
      if (!keepState) {
        this.view = prefs?.view ?? emptyView();
        this.hidden = new Set(prefs?.hidden ?? []);
        this.collapsed.clear();
        this.selected.clear();
        this.counts = null;
        this.report = null;
        this.placedFilter = "all";
        this.searchInput.value = this.view.search;
        this.message = null;
      } else if (!this.message) this.message = { text: `Reloaded ${plural(ds.records.length, "record")}.`, error: false };
      for (const id of [...this.selected]) if (!getRecord(ds, id)) this.selected.delete(id);
      this.limit = PAGE;
      if (file.token) this.settings.last = { token: file.token, name: file.name, sheet: this.sheet };
      this.persist();
      this.renderAll();
    } catch (e) {
      this.fail(e);
    }
  }

  private prefs(): SourcePrefs | undefined {
    return this.source ? this.settings.sources[this.source.id] : undefined;
  }

  private persist(): void {
    if (this.source) {
      const old = this.settings.sources[this.source.id];
      this.settings.sources[this.source.id] = {
        ...old,
        view: this.view,
        hidden: [...this.hidden],
        keyField: this.source.keyField,
        decimalSeparator: this.source.decimalSeparator,
      };
    }
    this.host.saveSettings(this.settings);
  }

  private fail(e: unknown): void {
    this.message = { text: e instanceof Error ? e.message : String(e), error: true };
    this.renderStatus();
  }

  private info(text: string): void {
    this.message = { text, error: false };
    this.renderStatus();
  }

  // ---------- view changes ----------

  private update(change: Partial<ViewSpec>): void {
    this.view = { ...this.view, ...change };
    this.limit = PAGE;
    this.persist();
    this.renderControls();
    this.renderGrid();
  }

  private onSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.update({ search: this.searchInput.value }), 150);
  }

  /** Select records programmatically (preview and tests). */
  selectRecords(ids: readonly string[]): void {
    this.selected = new Set(ids);
    this.anchor = ids[ids.length - 1] ?? null;
    this.renderDocBar();
    this.renderGrid();
  }

  private onRowClick(id: string, e: MouseEvent, visibleIds: string[]): void {
    if (e.shiftKey && this.anchor) {
      const a = visibleIds.indexOf(this.anchor);
      const b = visibleIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        this.selected = new Set(visibleIds.slice(from, to + 1));
      }
    } else if (e.metaKey || e.ctrlKey) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
      this.anchor = id;
    } else {
      this.selected = this.selected.size === 1 && this.selected.has(id) ? new Set() : new Set([id]);
      this.anchor = id;
    }
    this.renderDocBar();
    this.renderGrid();
  }

  // ---------- document operations ----------

  private requireDocument(): DocumentAdapter | null {
    const doc = this.host.getDocument();
    if (!doc) this.fail(new Error("Open an InDesign document first."));
    return doc;
  }

  private contexts(): Map<string, SourceContext> {
    const m = new Map<string, SourceContext>();
    if (this.source) {
      m.set(this.source.id, {
        source: this.source,
        images: { imageFolder: this.prefs()?.imageFolder, dataFolder: this.file?.path ? dirname(this.file.path) : undefined },
      });
    }
    return m;
  }

  /** Records currently selected, in the order they appear in the grid. */
  private selectedRecords(): string[] {
    if (!this.source) return [];
    const order = applyView(this.source, this.view).records.map((r) => r.id);
    const inView = order.filter((id) => this.selected.has(id));
    const rest = [...this.selected].filter((id) => !order.includes(id));
    return [...inView, ...rest];
  }

  /** Place one field (or all visible fields) of the selected records at the document selection. */
  placeFields(fields: string[]): void {
    const ds = this.source;
    const doc = this.requireDocument();
    if (!ds || !doc) return;
    const ids = this.selectedRecords();
    if (ids.length === 0) return this.fail(new Error("Select one or more records in the list first."));
    const types = new Map(ds.fields.map((f) => [f.name, f.type] as const));
    try {
      if (fields.length === 1 && types.get(fields[0]!) === "image") {
        const field = fields[0]!;
        const id = ids[0]!;
        const res = resolveImage(formatValue(getRecord(ds, id)?.values[field]), this.contexts().get(ds.id)!.images);
        if (!res.ok) return this.fail(new Error(`${id} · ${field}: ${res.error}`));
        let target = "";
        doc.transaction("OpenCatalog: Place image", () => {
          target = doc.placeImage({ source: ds.id, key: id, field }, res.path).target;
        });
        this.afterPlace(`Placed image ${id} · ${field}${target === "new-frame" ? " in a new frame" : ""}.`, ids.length > 1 ? " Only the first selected record is placed for image fields." : "");
        return;
      }
      const items = ids.flatMap((id) =>
        fields.map((field) => ({
          link: { source: ds.id, key: id, field },
          text: toDocumentText(formatForDocument(getRecord(ds, id)?.values[field], ds)),
        })),
      );
      let target = "";
      doc.transaction("OpenCatalog: Place fields", () => {
        target = doc.placeText(items).target;
      });
      const where = target === "new-frame" ? " in a new text frame" : target === "text-frame" ? " in the selected frame" : "";
      this.afterPlace(`Placed ${plural(items.length, "field")}${where}.`, "");
    } catch (e) {
      this.fail(e);
    }
  }

  private afterPlace(text: string, note: string): void {
    this.refreshCounts(false);
    this.info(text + note);
    this.renderGrid();
  }

  /** Data → document. With `selectionOnly`, only links to the selected records are updated. */
  updateDocument(selectionOnly = false): void {
    const doc = this.requireDocument();
    if (!this.source || !doc) return;
    try {
      const items = doc.scan();
      const scope = selectionOnly ? { keys: new Set(this.selected) } : {};
      const plan = planUpdateDocument(items, this.contexts(), scope);
      const res = applyDocumentPlan(doc, plan);
      this.counts = placeCounts(items, this.source.id);
      const parts = [`${plural(res.updated, "field")} updated`, `${plan.unchanged} unchanged`];
      if (plan.otherSources) parts.push(`${plan.otherSources} from other sources skipped`);
      if (res.errors.length) parts.push(plural(res.errors.length, "error"));
      this.report = { title: `Update document: ${parts.join(", ")}.`, ok: res.errors.length === 0, issues: res.errors };
      this.message = null;
      this.renderAll();
    } catch (e) {
      this.fail(e);
    }
  }

  /** Document → data: take text edited in the document back into the panel. */
  updatePanel(): void {
    const doc = this.requireDocument();
    const ds = this.source;
    if (!ds || !doc) return;
    try {
      const items = doc.scan();
      const plan = planUpdatePanel(items, ds);
      this.source = applyPanelPlan(ds, plan);
      for (const e of plan.edits) this.edited.set(cellKey(e.recordId, e.field), e.to);
      this.counts = placeCounts(items, ds.id);
      const parts = [`${plural(plan.edits.length, "value")} taken from the document`, `${plan.unchanged} unchanged`];
      if (plan.conflicts.length) parts.push(plural(plan.conflicts.length, "conflict"));
      this.report = { title: `Update panel: ${parts.join(", ")}.`, ok: plan.conflicts.length === 0, issues: plan.conflicts };
      this.message = plan.edits.length ? { text: "Edited values are highlighted. Use “Save as CSV…” to keep them.", error: false } : null;
      this.renderAll();
    } catch (e) {
      this.fail(e);
    }
  }

  private refreshCounts(render = true): void {
    const doc = this.host.getDocument();
    if (!doc || !this.source) {
      this.counts = null;
    } else {
      try {
        this.counts = placeCounts(doc.scan(), this.source.id);
      } catch (e) {
        this.fail(e);
      }
    }
    if (render) {
      this.renderDocBar();
      this.renderGrid();
    }
  }

  private async saveCsv(): Promise<void> {
    if (!this.source) return;
    const base = this.source.name.replace(/\s*\[.*\]$/, "").replace(/\.[^.]+$/, "");
    try {
      if (await this.host.saveTextFile(`${base}.csv`, toCsv(this.source))) {
        this.edited.clear();
        this.info("Saved. Open the saved file to keep working from it.");
        this.renderAll();
      }
    } catch (e) {
      this.fail(e);
    }
  }

  private async chooseImageFolder(): Promise<void> {
    if (!this.source) return;
    const folder = await this.host.pickFolder();
    if (!folder) return;
    const prefs = this.prefs();
    if (prefs) prefs.imageFolder = folder;
    this.persist();
    this.renderDocBar();
  }

  // ---------- rendering ----------

  private renderAll(): void {
    this.renderToolbar();
    this.renderControls();
    this.renderDocBar();
    this.renderReport();
    this.renderGrid();
  }

  private renderToolbar(): void {
    clear(this.toolbar);
    const ds = this.source;
    add(this.toolbar,
      h("button", { class: "oc-btn oc-primary", on: { click: () => void this.pick() } }, ds ? "Open…" : "Open data file…"),
      ds && this.file?.token ? h("button", { class: "oc-btn", title: "Read the file again", on: { click: () => void this.reload() } }, "Reload") : null,
      ds ? h("span", { class: "oc-source", title: ds.name }, ds.name) : h("span", { class: "oc-source oc-muted" }, "No data source"),
    );
    if (ds && this.sheets.length > 1) {
      this.toolbar.append(
        h("label", { class: "oc-label" }, "Sheet"),
        select(this.sheets.map((s) => ({ value: s, label: s })), this.sheet ?? "", (s) => this.file && this.openPicked(this.file, s)),
      );
    }
    if (ds) {
      const keyOptions = [{ value: "", label: "(row number)" }, ...ds.fields.map((f) => ({ value: f.name, label: f.name }))];
      this.toolbar.append(
        h("label", { class: "oc-label", title: "Field that uniquely identifies each record. Placed fields remember this value." }, "Key"),
        select(keyOptions, ds.keyField ?? "", (v) => {
          try {
            this.source = withKeyField(ds, v === "" ? null : v);
            this.selected.clear();
            this.counts = null;
            this.message = null;
            this.persist();
          } catch (e) {
            this.fail(e);
          }
          this.renderAll();
        }),
        h("label", { class: "oc-label", title: "Decimal separator for numbers placed in the document" }, "Decimal"),
        select([{ value: ".", label: "1.5" }, { value: ",", label: "1,5" }], ds.decimalSeparator, (v) => {
          this.source = { ...ds, decimalSeparator: v as "." | "," };
          this.persist();
          this.renderGrid();
        }),
      );
    }
  }

  private renderControls(): void {
    clear(this.controls);
    clear(this.filterBox);
    clear(this.fieldsBox);
    const ds = this.source;
    this.searchInput.disabled = !ds;
    if (!ds) return;
    const fieldOpts = ds.fields.map((f) => ({ value: f.name, label: f.name }));
    const activeFilters = this.view.filters.length;

    add(this.controls,
      h("button", { class: `oc-btn${this.showFilters ? " oc-on" : ""}`, on: { click: () => { this.showFilters = !this.showFilters; this.renderControls(); } } },
        activeFilters ? `Filters (${activeFilters})` : "Filters"),
      h("button", { class: `oc-btn${this.showFields ? " oc-on" : ""}`, on: { click: () => { this.showFields = !this.showFields; this.renderControls(); } } },
        this.hidden.size ? `Fields (${ds.fields.length - this.hidden.size}/${ds.fields.length})` : "Fields"),
      h("label", { class: "oc-label" }, "Group by"),
      ...this.view.groupBy.map((g, i) =>
        h("span", { class: "oc-chip" }, g, h("button", { class: "oc-x", title: "Remove level", on: { click: () => this.update({ groupBy: this.view.groupBy.filter((_, j) => j !== i) }) } }, "×")),
      ),
      select(
        [{ value: "", label: this.view.groupBy.length ? "+ level" : "(none)" }, ...fieldOpts.filter((o) => !this.view.groupBy.includes(o.value))],
        "",
        (v) => v && this.update({ groupBy: [...this.view.groupBy, v] }),
      ),
      this.view.groupBy.length
        ? h("button", { class: "oc-btn oc-small", on: { click: () => this.toggleAll() } }, this.collapsed.size ? "Expand all" : "Collapse all")
        : null,
      this.view.sort.length
        ? h("button", { class: "oc-btn oc-small", title: "Clear sorting", on: { click: () => this.update({ sort: [] }) } }, "Clear sort")
        : null,
    );

    if (this.showFilters) this.renderFilters(fieldOpts);
    if (this.showFields) {
      this.fieldsBox.append(
        ...ds.fields.map((f) =>
          h("label", { class: "oc-fieldtoggle" },
            h("input", { type: "checkbox", checked: !this.hidden.has(f.name), on: { change: (e) => {
              if ((e.target as HTMLInputElement).checked) this.hidden.delete(f.name);
              else this.hidden.add(f.name);
              this.persist();
              this.renderControls();
              this.renderDocBar();
              this.renderGrid();
            } } }),
            ` ${f.name} `, h("span", { class: "oc-muted" }, f.type)),
        ),
      );
    }
  }

  private renderFilters(fieldOpts: { value: string; label: string }[]): void {
    const setFilter = (i: number, f: Filter) => this.update({ filters: this.view.filters.map((x, j) => (j === i ? f : x)) });
    this.filterBox.append(
      h("div", { class: "oc-row" },
        h("span", { class: "oc-label" }, "Match"),
        select([{ value: "all", label: "all filters" }, { value: "any", label: "any filter" }], this.view.filterMode, (v) => this.update({ filterMode: v as "all" | "any" })),
        h("button", { class: "oc-btn oc-small", on: { click: () => {
          const first = fieldOpts[0]?.value ?? "";
          this.update({ filters: [...this.view.filters, { field: first, op: "contains", value: "" }] });
        } } }, "+ Add filter"),
      ),
      ...this.view.filters.map((f, i) => {
        const meta = FILTER_OPS.find((o) => o.op === f.op);
        const value = h("input", { class: "oc-input", type: "text", value: f.value ?? "", placeholder: "value", disabled: !meta?.needsValue });
        // Committing re-renders and removes this input, which fires "change" again on blur: only commit real changes.
        const commit = () => { if (value.value !== (this.view.filters[i]?.value ?? "")) setFilter(i, { ...f, value: value.value }); };
        value.addEventListener("change", commit);
        value.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") commit(); });
        return h("div", { class: "oc-row" },
          select(fieldOpts, f.field, (v) => setFilter(i, { ...f, field: v })),
          select(FILTER_OPS.map((o) => ({ value: o.op, label: o.label })), f.op, (v) => setFilter(i, { ...f, op: v as FilterOp })),
          value,
          h("button", { class: "oc-x", title: "Remove filter", on: { click: () => this.update({ filters: this.view.filters.filter((_, j) => j !== i) }) } }, "×"),
        );
      }),
    );
  }

  private renderDocBar(): void {
    clear(this.docBar);
    const ds = this.source;
    if (!ds) return;
    const visible = ds.fields.filter((f) => !this.hidden.has(f.name));
    if (!visible.some((f) => f.name === this.placeField)) this.placeField = visible[0]?.name ?? "";
    const n = this.selected.size;
    // Documents open and close without notifying the panel, so buttons stay enabled and
    // each action checks for a document when clicked.
    const field = ds.fields.find((f) => f.name === this.placeField);

    add(this.docBar,
      h("div", { class: "oc-row" },
        h("span", { class: "oc-label" }, n ? `${plural(n, "record")} selected` : "Select records to place"),
        select(visible.map((f) => ({ value: f.name, label: f.type === "image" ? `${f.name} (image)` : f.name })), this.placeField, (v) => {
          this.placeField = v;
          this.renderDocBar();
        }),
        h("button", { class: "oc-btn", disabled: !n || !field, title: "Place at the text cursor, into the selected frame, or in a new frame", on: { click: () => this.placeFields([this.placeField]) } },
          field?.type === "image" ? "Place image" : "Place field"),
        h("button", { class: "oc-btn", disabled: !n, title: "One paragraph per visible text field", on: { click: () => this.placeFields(visible.filter((f) => f.type !== "image").map((f) => f.name)) } }, "Place visible fields"),
      ),
      h("div", { class: "oc-row" },
        h("button", { class: "oc-btn oc-primary", title: "Write current data into every linked field of the document", on: { click: () => this.updateDocument(false) } }, "Update document"),
        h("button", { class: "oc-btn", disabled: !n, title: "Update only the fields of the selected records", on: { click: () => this.updateDocument(true) } }, "Update selected"),
        h("button", { class: "oc-btn", title: "Take text edited in the document back into the panel", on: { click: () => this.updatePanel() } }, "Update panel"),
        h("span", { class: "oc-label" }, "Show"),
        select([{ value: "all", label: "all records" }, { value: "placed", label: "placed" }, { value: "unplaced", label: "not placed" }], this.placedFilter, (v) => {
          this.placedFilter = v as PlacedFilter;
          if (v !== "all") this.refreshCounts(false);
          this.renderDocBar();
          this.renderGrid();
        }),
        h("button", { class: "oc-btn oc-small", title: "Count how often each record is placed", on: { click: () => this.refreshCounts() } }, "Count"),
      ),
      h("div", { class: "oc-row" },
        h("span", { class: "oc-label" }, "Images"),
        h("span", { class: "oc-path", title: this.prefs()?.imageFolder ?? "" }, this.prefs()?.imageFolder ?? (this.file?.path ? "next to the data file" : "no folder chosen")),
        h("button", { class: "oc-btn oc-small", on: { click: () => void this.chooseImageFolder() } }, "Choose…"),
        this.edited.size ? h("span", { class: "oc-edited-note" }, plural(this.edited.size, "edited value")) : null,
        this.edited.size ? h("button", { class: "oc-btn oc-small", on: { click: () => void this.saveCsv() } }, "Save as CSV…") : null,
      ),
    );
  }

  private renderReport(): void {
    clear(this.reportBox);
    const r = this.report;
    if (!r) return;
    const doc = this.host.getDocument();
    add(this.reportBox,
      h("div", { class: `oc-row ${r.ok ? "oc-info" : "oc-error"}` },
        h("span", {}, r.title),
        h("button", { class: "oc-x", title: "Close", on: { click: () => { this.report = null; this.renderReport(); } } }, "×"),
      ),
      ...r.issues.slice(0, 50).map((i: Issue) =>
        h("div", { class: "oc-issue", title: "Show in document", on: { click: () => doc?.reveal(i.item as LinkedItem) } },
          i.item.page ? h("span", { class: "oc-muted" }, `p. ${i.item.page} · `) : null, i.message),
      ),
      r.issues.length > 50 ? h("div", { class: "oc-issue oc-muted" }, `…and ${r.issues.length - 50} more`) : null,
    );
  }

  private toggleAll(): void {
    if (!this.source) return;
    if (this.collapsed.size) this.collapsed.clear();
    else for (const k of allGroupKeys(applyView(this.source, this.view).groups)) this.collapsed.add(k);
    this.renderControls();
    this.renderGrid();
  }

  private viewSource(ds: DataSource): DataSource {
    if (this.placedFilter === "all" || !this.counts) return ds;
    const counts = this.counts;
    const want = this.placedFilter === "placed";
    return { ...ds, records: ds.records.filter((r) => (counts.get(r.id) ?? 0) > 0 === want) };
  }

  private renderGrid(): void {
    clear(this.grid);
    const ds = this.source;
    if (!ds) {
      this.grid.append(
        h("div", { class: "oc-empty" },
          h("p", {}, "Open a CSV, TXT, Excel (.xlsx) or JSON file to start."),
          h("p", { class: "oc-muted" }, "The first row is used as field names."),
        ),
      );
      this.renderStatus(null);
      return;
    }
    const cols = ds.fields.filter((f) => !this.hidden.has(f.name));
    const result = applyView(this.viewSource(ds), this.view);
    const rows = flattenView(result, this.collapsed);
    const visibleIds = rows.flatMap((r) => (r.kind === "record" ? [r.record.id] : []));
    const width = cols.length * COL_WIDTH + 32;

    const header = h("div", { class: "oc-tr oc-head", style: `width:${width}px` },
      h("div", { class: "oc-gutter", title: "Times placed in the document" }, this.counts ? "#" : ""),
      ...cols.map((f) => {
        const idx = this.view.sort.findIndex((s) => s.field === f.name);
        const s = this.view.sort[idx];
        const arrow = s ? (s.dir === "asc" ? " ▲" : " ▼") + (this.view.sort.length > 1 ? String(idx + 1) : "") : "";
        return h("div", {
          class: `oc-th${f.name === ds.keyField ? " oc-key" : ""}`,
          style: `width:${COL_WIDTH}px`,
          title: `${f.name} (${f.type})${f.name === ds.keyField ? " · key" : ""}\nClick to sort, Shift+click to add a sort level`,
          on: { click: (e) => this.update({ sort: cycleSort(this.view.sort, f.name, (e as MouseEvent).shiftKey) }) },
        }, f.name + arrow);
      }),
    );

    const body = h("div", { class: "oc-body", style: `width:${width}px` });
    rows.slice(0, this.limit).forEach((row) => body.appendChild(this.renderRow(row, cols.map((c) => c.name), visibleIds)));
    if (rows.length > this.limit) {
      body.appendChild(
        h("div", { class: "oc-more" },
          h("button", { class: "oc-btn oc-small", on: { click: () => { this.limit += PAGE; this.renderGrid(); } } }, `Show ${Math.min(PAGE, rows.length - this.limit)} more`),
        ),
      );
    }
    if (rows.length === 0) body.appendChild(h("div", { class: "oc-empty oc-muted" }, "No records match."));
    this.grid.append(header, body);
    this.renderStatus(result.records.length);
  }

  private renderRow(row: DisplayRow, cols: string[], visibleIds: string[]): HTMLElement {
    if (row.kind === "group") {
      const g = row.group;
      const label = g.value === null ? "(empty)" : formatValue(g.value);
      return h("div", {
        class: "oc-tr oc-group",
        style: `padding-left:${g.depth * 14}px`,
        on: { click: () => {
          if (this.collapsed.has(g.key)) this.collapsed.delete(g.key);
          else this.collapsed.add(g.key);
          this.renderGrid();
        } },
      }, h("span", { class: "oc-twisty" }, row.collapsed ? "▸" : "▾"), h("span", { class: "oc-muted oc-gap" }, `${g.field}:`), h("span", { class: "oc-gap" }, label), h("span", { class: "oc-count" }, `(${g.count})`));
    }
    const r = row.record;
    const count = this.counts?.get(r.id) ?? 0;
    return h("div", {
      class: `oc-tr oc-rec${this.selected.has(r.id) ? " oc-sel" : ""}`,
      title: `Record ${r.id}${this.counts ? ` · placed ${count}×` : ""}\nClick to select, Shift/Cmd+click to extend`,
      "data-id": r.id,
      on: { click: (e) => this.onRowClick(r.id, e as MouseEvent, visibleIds) },
    },
      h("div", { class: `oc-gutter${count ? " oc-placed" : ""}`, style: row.depth ? `width:${16 + row.depth * 6}px` : "" }, this.counts ? (count ? String(count) : "·") : ""),
      ...cols.map((c) => {
        const v = r.values[c];
        const text = this.source ? formatForDocument(v, this.source) : formatValue(v);
        const edited = this.edited.has(cellKey(r.id, c));
        return h("div", {
          class: `oc-td${typeof v === "number" ? " oc-num" : ""}${edited ? " oc-edited" : ""}`,
          style: `width:${COL_WIDTH}px`,
          title: edited ? `${text}\n(edited in the document, not saved)` : text,
        }, text.replace(/\s*[\r\n]\s*/g, " ⏎ "));
      }),
    );
  }

  private renderStatus(shown?: number | null): void {
    clear(this.status);
    const ds = this.source;
    if (shown !== undefined && shown !== null && ds) {
      const filtered = shown !== ds.records.length;
      this.status.append(h("span", {}, filtered ? `${shown} of ${ds.records.length} records` : `${ds.records.length} records`));
      this.status.append(h("span", { class: "oc-muted" }, ` · ${ds.fields.length} fields${ds.keyField ? ` · key: ${ds.keyField}` : " · no key"}`));
    } else if (shown !== null && ds) {
      this.status.append(h("span", {}, `${ds.records.length} records`));
    }
    if (this.message) this.status.append(h("div", { class: this.message.error ? "oc-error" : "oc-info" }, this.message.text));
  }
}
