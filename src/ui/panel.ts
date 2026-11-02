/**
 * The OpenCatalog data panel.
 * Phase 0: load a source and browse it (search, filters, sort, grouping, field visibility).
 * Phase 1: select records, place fields in the document, Update Document / Update Panel,
 *          placement counts and an error report.
 */
import {
  ComputedDef,
  ComputedError,
  DataSource,
  DisplayRow,
  FieldFormat,
  FieldSettings,
  SourceDiff,
  applyFieldSettings,
  buildFlow,
  groupStarts,
  planTemplatePagination,
  diffSources,
  formatFieldValue,
  imageUrlsFor,
  isEmptyDiff,
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
import { ENCODING_LABELS, EncodingChoice, SUPPORTED_EXTENSIONS, TextEncoding, loadFromBytes, toCsv } from "../providers";
import { add, clear, h, select } from "./dom";
import { renderFieldsEditor } from "./fields-editor";

const PAGE = 300;
const COL_WIDTH = 132;

type PlacedFilter = "all" | "placed" | "unplaced" | "new" | "changed";

interface SourcePrefs {
  view: ViewSpec;
  hidden: string[];
  keyField?: string | null;
  decimalSeparator?: "." | ",";
  imageFolder?: string;
  formats?: Record<string, FieldFormat>;
  computed?: ComputedDef[];
  /** Gap between repeated layout blocks, in document units. */
  gap?: number;
  tableHeader?: boolean;
  pagination?: PaginationPrefs;
}

interface PaginationPrefs {
  mode: "template" | "flow";
  scope: "view" | "selected";
  /** Template mode: start a new page for each value of the first group field. */
  pageBreaks: boolean;
  /** Flow mode: write group headings. */
  headings: boolean;
  separator: "paragraph" | "tab";
  pdfPreset?: string;
}

const DEFAULT_PAGINATION: PaginationPrefs = { mode: "template", scope: "view", pageBreaks: false, headings: true, separator: "paragraph" };

interface Settings {
  last?: { token: string; name: string; sheet?: string };
  sources: Record<string, SourcePrefs>;
  /** Forced text encoding per data file name (absent = auto-detect). */
  encodings?: Record<string, EncodingChoice>;
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
  /** The source as loaded (plus key, decimal and Update Panel edits), before computed fields. */
  private raw: DataSource | null = null;
  /** `raw` with formats and computed fields applied: what the panel shows and places. */
  private source: DataSource | null = null;
  private computedErrors: ComputedError[] = [];
  private diff: SourceDiff | null = null;
  private downloaded = new Map<string, string>();
  private editingFormat: string | null = null;
  private showPaginate = false;
  private file: PickedFile | null = null;
  private sheets: string[] = [];
  private sheet: string | undefined;
  private encoding: TextEncoding | undefined;
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
      const { source, sheets, encoding } = loadFromBytes(file.name, file.bytes, { sheet, encoding: this.settings.encodings?.[file.name] ?? "auto" });
      this.encoding = encoding;
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
      const previous = this.raw && this.raw.id === ds.id ? this.raw : null;
      this.diff = previous ? diffSources(previous, ds) : null;
      if (this.diff && isEmptyDiff(this.diff)) this.diff = null;
      this.raw = ds;
      this.rebuild();
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
      } else {
        const prefix = this.message?.text.startsWith("Reloading discarded") ? `${this.message.text} ` : "";
        this.message = { text: `${prefix}Reloaded ${plural(ds.records.length, "record")}.${this.diffSummary()}`, error: false };
      }
      if (keepState && this.diff?.removed.length) this.reportRemoved(this.diff.removed);
      for (const id of [...this.selected]) if (!getRecord(ds, id)) this.selected.delete(id);
      if (!keepState) this.diff = null;
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

  /** Re-apply formats and computed fields on top of the raw source. */
  private rebuild(): void {
    if (!this.raw) return;
    const prefs = this.prefs();
    const settings: FieldSettings = { formats: prefs?.formats, computed: prefs?.computed };
    const { source, errors } = applyFieldSettings(this.raw, settings);
    this.source = source;
    this.computedErrors = errors;
  }

  private settingsFor(): SourcePrefs | undefined {
    if (!this.raw) return undefined;
    const id = this.raw.id;
    this.settings.sources[id] ??= { view: this.view, hidden: [...this.hidden] };
    return this.settings.sources[id];
  }

  private diffSummary(): string {
    const d = this.diff;
    if (!d) return " No changes.";
    const parts: string[] = [];
    if (d.added.length) parts.push(`${d.added.length} new`);
    if (d.changed.size) parts.push(`${d.changed.size} changed`);
    if (d.removed.length) parts.push(`${d.removed.length} deleted`);
    if (d.addedFields.length) parts.push(`new fields: ${d.addedFields.join(", ")}`);
    if (d.removedFields.length) parts.push(`removed fields: ${d.removedFields.join(", ")}`);
    return ` ${parts.join(", ")}.`;
  }

  /** After a reload, list deleted records that are still placed in the document. */
  private reportRemoved(removed: string[]): void {
    const doc = this.host.getDocument();
    if (!doc || !this.source) return;
    try {
      const gone = new Set(removed);
      const issues = doc.scan().filter((i) => i.link.source === this.source!.id && gone.has(i.link.key))
        .map((item) => ({ item, message: `Record "${item.link.key}" was deleted from the data but is still placed (${item.link.field})` }));
      if (issues.length) this.report = { title: `Synchronize: ${plural(issues.length, "placed field")} of deleted records.`, ok: false, issues };
    } catch {
      /* report is best effort */
    }
  }

  private persist(): void {
    if (this.raw) {
      const old = this.settings.sources[this.raw.id];
      this.settings.sources[this.raw.id] = {
        ...old,
        view: this.view,
        hidden: [...this.hidden],
        keyField: this.raw.keyField,
        decimalSeparator: this.raw.decimalSeparator,
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
        images: {
          imageFolder: this.prefs()?.imageFolder,
          dataFolder: this.file?.path ? dirname(this.file.path) : undefined,
          downloaded: this.downloaded,
        },
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

  private fieldText(ds: DataSource, id: string, field: string): string {
    const def = ds.fields.find((f) => f.name === field);
    return toDocumentText(formatFieldValue(getRecord(ds, id)?.values[field], def, ds));
  }

  /** Download image URLs not yet in the session cache; returns failures as messages. */
  private async ensureDownloaded(urls: string[]): Promise<Map<string, string>> {
    const missing = urls.filter((u) => !this.downloaded.has(u));
    if (missing.length === 0) return new Map();
    this.info(`Downloading ${plural(missing.length, "image")}…`);
    const res = await this.host.downloadImages(missing);
    for (const [u, path] of res.downloaded) this.downloaded.set(u, path);
    return res.failed;
  }

  /** Place one field (or all visible fields) of the selected records at the document selection. */
  async placeFields(fields: string[]): Promise<void> {
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
        const value = formatValue(getRecord(ds, id)?.values[field]).trim();
        if (/^https?:\/\//i.test(value)) await this.ensureDownloaded([value]);
        const res = resolveImage(value, this.contexts().get(ds.id)!.images);
        if (!res.ok) return this.fail(new Error(`${id} · ${field}: ${res.error}`));
        let target = "";
        doc.transaction("OpenCatalog: Place image", () => {
          target = doc.placeImage({ source: ds.id, key: id, field }, res.path).target;
        });
        this.afterPlace(`Placed image ${id} · ${field}${target === "new-frame" ? " in a new frame" : ""}.`, ids.length > 1 ? " Only the first selected record is placed for image fields." : "");
        return;
      }
      const items = ids.flatMap((id) => fields.map((field) => ({ link: { source: ds.id, key: id, field }, text: this.fieldText(ds, id, field) })));
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

  /** One table row per selected record, one column per visible text field. */
  placeTable(): void {
    const ds = this.source;
    const doc = this.requireDocument();
    if (!ds || !doc) return;
    const ids = this.selectedRecords();
    if (ids.length === 0) return this.fail(new Error("Select the records for the table rows first."));
    const cols = ds.fields.filter((f) => !this.hidden.has(f.name) && f.type !== "image").map((f) => f.name);
    const header = this.prefs()?.tableHeader === false ? null : cols;
    try {
      const rows = ids.map((id) => cols.map((field) => ({ link: { source: ds.id, key: id, field }, text: this.fieldText(ds, id, field) })));
      doc.transaction("OpenCatalog: Place table", () => {
        doc.placeTable(header, rows);
      });
      this.afterPlace(`Placed a table with ${plural(ids.length, "row")} and ${plural(cols.length, "column")}.`, "");
    } catch (e) {
      this.fail(e);
    }
  }

  /** Repeat the selected layout block (showing one record) for every selected record, then update. */
  async repeatLayout(): Promise<void> {
    const ds = this.source;
    const doc = this.requireDocument();
    if (!ds || !doc) return;
    const ids = this.selectedRecords();
    if (ids.length === 0) return this.fail(new Error("Select the records to lay out in the list first."));
    try {
      const gap = this.prefs()?.gap ?? 4;
      let res = { sampleKey: "", placed: [] as string[], notPlaced: [] as string[] };
      doc.transaction("OpenCatalog: Repeat layout", () => {
        res = doc.repeatSelection(ds.id, ids, gap);
      });
      if (res.placed.length) await this.updateDocument(false, new Set(res.placed), true);
      const extra = res.notPlaced.length ? ` ${plural(res.notPlaced.length, "record")} did not fit on the page (pagination comes in phase 3): ${res.notPlaced.slice(0, 5).join(", ")}${res.notPlaced.length > 5 ? "…" : ""}.` : "";
      this.message = { text: `Repeated the layout of ${res.sampleKey} for ${plural(res.placed.length, "record")}.${extra}`, error: res.notPlaced.length > 0 };
      this.renderStatus();
    } catch (e) {
      this.fail(e);
    }
  }

  private afterPlace(text: string, note: string): void {
    this.refreshCounts(false);
    this.info(text + note);
    this.renderGrid();
  }

  private pagination(): PaginationPrefs {
    return { ...DEFAULT_PAGINATION, ...(this.prefs()?.pagination ?? {}) };
  }

  private setPagination(change: Partial<PaginationPrefs>): void {
    const p = this.settingsFor();
    if (!p) return;
    p.pagination = { ...this.pagination(), ...change };
    this.persist();
    this.renderDocBar();
  }

  /** Records to paginate, in panel order (groups first, then sort). */
  private paginationRecords(scope: "view" | "selected") {
    if (!this.source) return [];
    const ordered = applyView(this.viewSource(this.source), this.view).records;
    return scope === "selected" ? ordered.filter((r) => this.selected.has(r.id)) : ordered;
  }

  /** Lay out every record over as many pages as needed. */
  async paginate(): Promise<void> {
    const ds = this.source;
    const doc = this.requireDocument();
    if (!ds || !doc) return;
    const opts = this.pagination();
    const records = this.paginationRecords(opts.scope);
    if (records.length === 0) return this.fail(new Error(opts.scope === "selected" ? "Select records first, or paginate all records in view." : "No records in view."));
    try {
      if (opts.mode === "template") {
        const info = doc.templateInfo(ds.id);
        const group = this.view.groupBy[0];
        const plan = planTemplatePagination({
          block: info.block,
          area: info.area,
          gap: this.prefs()?.gap ?? 4,
          keys: records.map((r) => r.id),
          breakBefore: opts.pageBreaks && group ? groupStarts(records, group) : undefined,
        });
        let res = { pagesAdded: 0 };
        doc.transaction("OpenCatalog: Paginate", () => {
          res = doc.paginateTemplate(plan);
        });
        await this.updateDocument(false, new Set(records.map((r) => r.id)), true);
        this.message = { text: `Paginated ${plural(records.length, "record")} on ${plural(plan.pages.length, "page")} (${res.pagesAdded} added).`, error: false };
      } else {
        const fields = ds.fields.filter((f) => !this.hidden.has(f.name) && f.type !== "image" && !this.view.groupBy.includes(f.name)).map((f) => f.name);
        if (fields.length === 0) return this.fail(new Error("No visible text fields to flow."));
        const items = buildFlow(ds, records, { fields, headings: opts.headings ? this.view.groupBy : [] });
        let res = { pagesAdded: 0 };
        doc.transaction("OpenCatalog: Paginate (flow)", () => {
          res = doc.paginateFlow(items, opts.separator);
        });
        this.refreshCounts(false);
        this.message = { text: `Flowed ${plural(records.length, "record")}${res.pagesAdded ? `; ${plural(res.pagesAdded, "page")} added` : ""}.`, error: false };
      }
      this.renderAll();
    } catch (e) {
      this.fail(e);
    }
  }

  async exportPdf(): Promise<void> {
    const doc = this.requireDocument();
    if (!doc) return;
    try {
      const presets = doc.pdfPresets();
      const preset = this.pagination().pdfPreset && presets.includes(this.pagination().pdfPreset!) ? this.pagination().pdfPreset! : presets[0];
      if (!preset) return this.fail(new Error("No PDF presets found in InDesign."));
      const path = await this.host.pickSavePath(`${doc.name.replace(/\.indd$/i, "")}.pdf`);
      if (!path) return;
      doc.exportPdf(path, preset);
      this.info(`Exported PDF with “${preset}” to ${path}.`);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Data → document. With `selectionOnly`, only links to the selected records are updated. */
  async updateDocument(selectionOnly = false, keys?: Set<string>, quiet = false): Promise<void> {
    const doc = this.requireDocument();
    if (!this.source || !doc) return;
    try {
      const items = doc.scan();
      const scope = keys ? { keys } : selectionOnly ? { keys: new Set(this.selected) } : {};
      const scoped = scope.keys ? items.filter((i) => scope.keys!.has(i.link.key)) : items;
      const failed = await this.ensureDownloaded(imageUrlsFor(scoped, this.contexts()));
      const plan = planUpdateDocument(items, this.contexts(), scope);
      const res = applyDocumentPlan(doc, plan);
      for (const e of res.errors) {
        const reason = [...failed].find(([u]) => e.message.includes(u));
        if (reason) e.message += ` (${reason[1]})`;
      }
      this.counts = placeCounts(doc.scan(), this.source.id);
      const parts = [`${plural(res.updated, "field")} updated`, `${plan.unchanged} unchanged`];
      if (plan.otherSources) parts.push(`${plan.otherSources} from other sources skipped`);
      if (res.errors.length) parts.push(plural(res.errors.length, "error"));
      if (!quiet || res.errors.length) this.report = { title: `Update document: ${parts.join(", ")}.`, ok: res.errors.length === 0, issues: res.errors };
      if (!quiet) this.message = null;
      this.renderAll();
    } catch (e) {
      this.fail(e);
    }
  }

  /** Document → data: take text edited in the document back into the panel. */
  updatePanel(): void {
    const doc = this.requireDocument();
    const ds = this.source;
    if (!ds || !doc || !this.raw) return;
    try {
      const items = doc.scan();
      const plan = planUpdatePanel(items, ds);
      this.raw = applyPanelPlan(this.raw, plan);
      this.rebuild();
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
      if (await this.host.saveTextFile(`${base}.csv`, toCsv(this.raw ?? this.source))) {
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
    if (ds && this.file && this.encoding) {
      const forced = this.settings.encodings?.[this.file.name] ?? "auto";
      const opts = (Object.keys(ENCODING_LABELS) as EncodingChoice[]).map((k) => ({
        value: k,
        label: k === "auto" ? `Auto (${ENCODING_LABELS[this.encoding!]})` : ENCODING_LABELS[k],
      }));
      this.toolbar.append(
        h("label", { class: "oc-label", title: "Text encoding of the file. Use Mac Roman for CSV files saved by Excel for Mac as 'CSV (Macintosh)'." }, "Encoding"),
        select(opts, forced, (v) => {
          const file = this.file;
          if (!file) return;
          this.settings.encodings = { ...(this.settings.encodings ?? {}), [file.name]: v as EncodingChoice };
          if (v === "auto") delete this.settings.encodings[file.name];
          this.openPicked(file, this.sheet, true);
        }),
      );
    }
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
            this.raw = withKeyField(this.raw ?? ds, v === "" ? null : v);
            this.rebuild();
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
          if (this.raw) this.raw = { ...this.raw, decimalSeparator: v as "." | "," };
          this.rebuild();
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
        renderFieldsEditor({
          source: ds,
          hidden: this.hidden,
          editing: this.editingFormat,
          computed: this.prefs()?.computed ?? [],
          errors: this.computedErrors,
          onToggleHidden: (field, visible) => {
            if (visible) this.hidden.delete(field);
            else this.hidden.add(field);
            this.persist();
            this.renderControls();
            this.renderDocBar();
            this.renderGrid();
          },
          onEdit: (field) => {
            this.editingFormat = field;
            this.renderControls();
          },
          onFormat: (field, format) => this.changeSettings((p) => {
            const formats = { ...(p.formats ?? {}) };
            if (format) formats[field] = format;
            else delete formats[field];
            p.formats = formats;
          }),
          onComputed: (defs) => this.changeSettings((p) => {
            p.computed = defs;
          }),
        }),
      );
    }
  }

  private changeSettings(fn: (p: SourcePrefs) => void): void {
    const p = this.settingsFor();
    if (!p) return;
    fn(p);
    this.rebuild();
    this.persist();
    this.renderControls();
    this.renderDocBar();
    this.renderGrid();
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
        h("button", { class: "oc-btn", disabled: !n, title: "One row per selected record, one column per visible text field; every cell stays linked", on: { click: () => this.placeTable() } }, "Place as table"),
        h("label", { class: "oc-label", title: "First table row shows the field names" },
          h("input", { type: "checkbox", checked: this.prefs()?.tableHeader !== false, on: { change: (e) => {
            const p = this.settingsFor();
            if (p) p.tableHeader = (e.target as HTMLInputElement).checked;
            this.persist();
          } } }), " header"),
        h("button", { class: "oc-btn", disabled: !n, title: "Select frames that show one record (with the selection tool), then copy that layout for every selected record on the page", on: { click: () => void this.repeatLayout() } }, "Repeat layout"),
        h("span", { class: "oc-label", title: "Space between repeated blocks, in document units" }, "gap"),
        (() => {
          const gap = h("input", { class: "oc-input", type: "number", min: "0", value: this.prefs()?.gap ?? 4, style: "width:52px" });
          gap.addEventListener("change", () => {
            const p = this.settingsFor();
            if (p) p.gap = Math.max(0, Number(gap.value) || 0);
            this.persist();
          });
          return gap;
        })(),
      ),
      h("div", { class: "oc-row" },
        h("button", { class: "oc-btn oc-primary", title: "Write current data into every linked field of the document", on: { click: () => this.updateDocument(false) } }, "Update document"),
        h("button", { class: "oc-btn", disabled: !n, title: "Update only the fields of the selected records", on: { click: () => this.updateDocument(true) } }, "Update selected"),
        h("button", { class: "oc-btn", title: "Take text edited in the document back into the panel", on: { click: () => this.updatePanel() } }, "Update panel"),
        h("span", { class: "oc-label" }, "Show"),
        select([
          { value: "all", label: "all records" }, { value: "placed", label: "placed" }, { value: "unplaced", label: "not placed" },
          ...(this.diff ? [{ value: "new", label: `new (${this.diff.added.length})` }, { value: "changed", label: `changed (${this.diff.changed.size})` }] : []),
        ], this.placedFilter, (v) => {
          this.placedFilter = v as PlacedFilter;
          if (v === "placed" || v === "unplaced") this.refreshCounts(false);
          this.renderDocBar();
          this.renderGrid();
        }),
        h("button", { class: "oc-btn oc-small", title: "Count how often each record is placed", on: { click: () => this.refreshCounts() } }, "Count"),
      ),
      this.renderPaginateRow(),
      this.showPaginate ? this.renderPaginateBox() : null,
      h("div", { class: "oc-row" },
        h("span", { class: "oc-label" }, "Images"),
        h("span", { class: "oc-path", title: this.prefs()?.imageFolder ?? "" }, this.prefs()?.imageFolder ?? (this.file?.path ? "next to the data file" : "no folder chosen")),
        h("button", { class: "oc-btn oc-small", on: { click: () => void this.chooseImageFolder() } }, "Choose…"),
        this.edited.size ? h("span", { class: "oc-edited-note" }, plural(this.edited.size, "edited value")) : null,
        this.edited.size ? h("button", { class: "oc-btn oc-small", on: { click: () => void this.saveCsv() } }, "Save as CSV…") : null,
      ),
    );
  }

  private renderPaginateRow(): HTMLElement {
    return h("div", { class: "oc-row" },
      h("button", { class: `oc-btn${this.showPaginate ? " oc-on" : ""}`, on: { click: () => { this.showPaginate = !this.showPaginate; this.renderDocBar(); } } }, "Paginate…"),
      h("button", { class: "oc-btn", title: "Export the document as PDF", on: { click: () => void this.exportPdf() } }, "Export PDF…"),
    );
  }

  private renderPaginateBox(): HTMLElement {
    const o = this.pagination();
    const doc = this.host.getDocument();
    let presets: string[] = [];
    try {
      presets = doc?.pdfPresets() ?? [];
    } catch {
      presets = [];
    }
    const group = this.view.groupBy[0];
    const count = this.paginationRecords(o.scope).length;
    return h("div", { class: "oc-paginate" },
      h("div", { class: "oc-row" },
        h("span", { class: "oc-label" }, "Mode"),
        select([
          { value: "template", label: "Template: repeat the selected block" },
          { value: "flow", label: "Text flow: one paragraph per record" },
        ], o.mode, (v) => this.setPagination({ mode: v as PaginationPrefs["mode"] })),
        h("span", { class: "oc-label" }, "Records"),
        select([{ value: "view", label: "all in view" }, { value: "selected", label: "selected" }], o.scope, (v) => this.setPagination({ scope: v as PaginationPrefs["scope"] })),
        h("span", { class: "oc-muted" }, `(${count}, in list order)`),
      ),
      o.mode === "template"
        ? h("div", { class: "oc-row" },
            h("label", { class: "oc-label", title: group ? `Start a new page whenever ${group} changes` : "Group the list to enable page breaks" },
              h("input", { type: "checkbox", checked: o.pageBreaks, disabled: !group, on: { change: (e) => this.setPagination({ pageBreaks: (e.target as HTMLInputElement).checked }) } }),
              ` new page for each ${group ?? "group (group the list first)"}`),
            h("span", { class: "oc-muted" }, "Select the template block in InDesign; the gap above is used between copies."),
          )
        : h("div", { class: "oc-row" },
            h("label", { class: "oc-label" },
              h("input", { type: "checkbox", checked: o.headings, disabled: this.view.groupBy.length === 0, on: { change: (e) => this.setPagination({ headings: (e.target as HTMLInputElement).checked }) } }),
              this.view.groupBy.length ? ` headings for ${this.view.groupBy.join(" › ")}` : " headings (group the list first)"),
            h("span", { class: "oc-label" }, "Fields separated by"),
            select([{ value: "paragraph", label: "paragraph" }, { value: "tab", label: "tab" }], o.separator, (v) => this.setPagination({ separator: v as PaginationPrefs["separator"] })),
            h("span", { class: "oc-muted", title: "Paragraph styles named OC Heading 1, OC Heading 2… and OC Record are applied when they exist" }, "styles: OC Heading n, OC Record"),
          ),
      h("div", { class: "oc-row" },
        h("button", { class: "oc-btn oc-primary", on: { click: () => void this.paginate() } }, "Paginate"),
        h("span", { class: "oc-label" }, "PDF preset"),
        presets.length
          ? select(presets.map((p) => ({ value: p, label: p })), o.pdfPreset && presets.includes(o.pdfPreset) ? o.pdfPreset : presets[0]!, (v) => this.setPagination({ pdfPreset: v }))
          : h("span", { class: "oc-muted" }, "(open a document)"),
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
    if (this.placedFilter === "new" || this.placedFilter === "changed") {
      const d = this.diff;
      if (!d) return ds;
      const ids = new Set(this.placedFilter === "new" ? d.added : [...d.changed.keys()]);
      return { ...ds, records: ds.records.filter((r) => ids.has(r.id)) };
    }
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
        const def = this.source?.fields.find((f) => f.name === c);
        const text = this.source ? formatFieldValue(v, def, this.source) : formatValue(v);
        const edited = this.edited.has(cellKey(r.id, c));
        const changed = !edited && (this.diff?.changed.get(r.id)?.includes(c) ?? false);
        const isNew = this.diff?.added.includes(r.id) ?? false;
        return h("div", {
          class: `oc-td${typeof v === "number" ? " oc-num" : ""}${edited ? " oc-edited" : changed ? " oc-changed" : isNew ? " oc-new" : ""}${def?.expression ? " oc-computed-cell" : ""}`,
          style: `width:${COL_WIDTH}px`,
          title: edited ? `${text}\n(edited in the document, not saved)` : changed ? `${text}\n(changed since the last load)` : text,
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
