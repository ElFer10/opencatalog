/**
 * The OpenCatalog data panel: load a source, then browse it with search, filters,
 * multi-level sort, hierarchical grouping and column visibility.
 */
import {
  DataSource,
  DisplayRow,
  FILTER_OPS,
  Filter,
  FilterOp,
  ViewSpec,
  allGroupKeys,
  applyView,
  cycleSort,
  emptyView,
  flattenView,
  formatValue,
  withKeyField,
} from "../core";
import type { Host, PickedFile } from "../hosts/host";
import { SUPPORTED_EXTENSIONS, loadFromBytes } from "../providers";
import { add, clear, h, select } from "./dom";

const PAGE = 300;
const COL_WIDTH = 132;

interface SourcePrefs {
  view: ViewSpec;
  hidden: string[];
  keyField?: string | null;
}

interface Settings {
  last?: { token: string; name: string; sheet?: string };
  sources: Record<string, SourcePrefs>;
}

function readSettings(raw: unknown): Settings {
  if (raw && typeof raw === "object" && "sources" in raw) return raw as Settings;
  return { sources: {} };
}

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
  private readonly grid = h("div", { class: "oc-grid" });
  private readonly status = h("div", { class: "oc-status" });

  constructor(private readonly root: HTMLElement, private readonly host: Host) {
    this.settings = readSettings(host.loadSettings());
    clear(root);
    root.appendChild(
      h("div", { class: "oc-panel" }, this.toolbar, h("div", { class: "oc-searchrow" }, this.searchInput), this.controls, this.filterBox, this.fieldsBox, this.grid, this.status),
    );
    this.renderAll();
  }

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
      this.source = ds;
      if (!keepState) {
        this.view = prefs?.view ?? emptyView();
        this.hidden = new Set(prefs?.hidden ?? []);
        this.collapsed.clear();
        this.searchInput.value = this.view.search;
      }
      this.limit = PAGE;
      this.message = keepState ? { text: `Reloaded ${ds.records.length} records.`, error: false } : null;
      if (file.token) this.settings.last = { token: file.token, name: file.name, sheet: this.sheet };
      this.persist();
      this.renderAll();
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    this.message = { text: e instanceof Error ? e.message : String(e), error: true };
    this.renderStatus();
  }

  private persist(): void {
    if (this.source) {
      this.settings.sources[this.source.id] = { view: this.view, hidden: [...this.hidden], keyField: this.source.keyField };
    }
    this.host.saveSettings(this.settings);
  }

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

  // ---------- rendering ----------

  private renderAll(): void {
    this.renderToolbar();
    this.renderControls();
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
        h("label", { class: "oc-label", title: "Field that uniquely identifies each record" }, "Key"),
        select(keyOptions, ds.keyField ?? "", (v) => {
          try {
            this.source = withKeyField(ds, v === "" ? null : v);
            this.message = null;
            this.persist();
          } catch (e) {
            this.fail(e);
          }
          this.renderToolbar();
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

  private toggleAll(): void {
    if (!this.source) return;
    if (this.collapsed.size) this.collapsed.clear();
    else for (const k of allGroupKeys(applyView(this.source, this.view).groups)) this.collapsed.add(k);
    this.renderControls();
    this.renderGrid();
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
    const result = applyView(ds, this.view);
    const rows = flattenView(result, this.collapsed);
    const width = cols.length * COL_WIDTH + 24;

    const header = h("div", { class: "oc-tr oc-head", style: `width:${width}px` },
      h("div", { class: "oc-gutter" }),
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
    rows.slice(0, this.limit).forEach((row) => body.appendChild(this.renderRow(row, cols.map((c) => c.name))));
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

  private renderRow(row: DisplayRow, cols: string[]): HTMLElement {
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
    return h("div", { class: "oc-tr", title: `Record ${r.id}` },
      h("div", { class: "oc-gutter", style: row.depth ? `width:${8 + row.depth * 6}px` : "" }),
      ...cols.map((c) => {
        const text = formatValue(r.values[c]);
        return h("div", { class: `oc-td${typeof r.values[c] === "number" ? " oc-num" : ""}`, style: `width:${COL_WIDTH}px`, title: text }, text.replace(/\s*\n\s*/g, " ⏎ "));
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
