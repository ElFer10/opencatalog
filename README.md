# OpenCatalog

Open-source, data-driven catalog publishing for Adobe InDesign, built as a UXP plugin.

> Status: **phase 1 (0.2.0)** — load a data source, place fields in an InDesign document and keep
> them in sync in both directions.

## What works today

- Data sources: **CSV / TXT / TSV** (delimiter detection, quoted fields, decimal commas,
  UTF-8 with or without BOM, Windows-1252 fallback), **Excel .xlsx** (all sheets, dates, booleans,
  shared and inline strings) and **JSON** (finds the record array, flattens nested objects).
- Automatic field types (text, number, date, boolean, image path) and key field detection
  (unique column, preferring names like `SKU`, `ID`, `Code`). The key can be changed in the panel.
- Panel: full-text search, filters (all/any, 11 operators), multi-level sort (click a column,
  Shift+click to add a level), hierarchical grouping with collapse/expand, show/hide fields.
- The panel remembers the last file and the view settings per data source.

Codes with leading zeros (EAN, article numbers like `00123`) are kept as text.

### Placing and updating (phase 1)

- Select records in the list (Shift/Cmd+click for several), pick a field and click **Place field**:
  - with a **text cursor** in a story, the value is inserted there as a tagged field
    (an `<oc_field>` XML element), so one paragraph can mix fixed text and several fields;
  - with a **text frame** selected, the whole frame shows the field (stored as a script label);
  - with **nothing selected**, a new text frame is created on the active page.
- **Place visible fields** inserts every visible text field of the selected records, one paragraph each.
- **Image fields**: select a graphic frame (or nothing) and click **Place image**. Relative paths are
  resolved against the image folder chosen in the panel, or the data file's folder. Images are fitted
  proportionally and centred.
- **Update document** writes the current data into every linked field (one undo step).
  **Update selected** limits it to the selected records.
- **Update panel** reads text edited in the document back into the data. Edited values are highlighted;
  **Save as CSV…** writes the updated data to a file.
- **Count** shows how many times each record is placed; **Show: placed / not placed** filters the list.
- Problems (deleted records, missing fields, missing image files, conflicting edits) appear in a report;
  click a line to jump to the item in the document.
- **Decimal** sets the decimal separator used when numbers are written into the document
  (CSV files with `;` default to a comma).

All links are stored inside the InDesign document itself; there is no external database.
Links remember the data source name (file name, plus sheet for Excel) and the record key, so keep a
stable key field (SKU, ID…) for reliable updates.

## Install in InDesign (development)

Requirements: Node.js 18+, InDesign 2023 (18.5) or later, and Adobe **UXP Developer Tools**
(installable from Creative Cloud).

```bash
npm install
npm run build
```

1. Start InDesign.
2. Open UXP Developer Tools → **Add Plugin** → choose `dist/plugin/manifest.json`.
3. Click **Load**. The panel appears in InDesign as **OpenCatalog** (Plugins menu).
4. While developing, `npm run watch` rebuilds on save; use **Reload** in UXP Developer Tools.

## Browser preview

The same panel runs in a browser without InDesign, next to a simulated document, which is handy
for UI work: open `dist/preview/index.html` after `npm run build`, click **Load demo data**, add
frames, place fields, then **Load demo with changed prices** and **Update document**.
Double-click a placed field in the simulated page to edit it and try **Update panel**.

## Development

```bash
npm run typecheck   # TypeScript, strict
npm test            # Vitest unit tests (core + providers)
npm run check       # all of the above + build
```

```
src/
  core/        data model, filters, sort, grouping, links and sync engine — no InDesign dependency
  providers/   CSV, XLSX (via fflate), JSON parsers → DataSource
  ui/          the panel (plain DOM, no framework)
  hosts/       environment adapters: UXP + InDesign DOM, browser preview, in-memory document
plugin/        UXP manifest
test/          unit tests and fixtures
```

## Roadmap

| Phase | Scope |
| --- | --- |
| 0 — Base | Data sources, panel with search, filters, sort and grouping ✅ |
| 1 — MVP | Place text and image fields, store links in the document, Update Document / Update Panel, place count and error report ✅ |
| 2 — Layout | Computed fields, number formats, images from URLs, formatting rules from snippets, tables, synchronize (new/changed/deleted) |
| 3 — Pagination | Flow and template pagination, then guides, masters and positions; page insertion; PDF export |
| 4 — Advanced | Local helper for ODBC/SQLite, generic REST connector for PIM/DAM, versions, merged documents, scripting API |

## Clean-room policy

OpenCatalog is an independent implementation. Contributors must not copy code, UI text, icons,
file formats or names from proprietary products. Work from the public behaviour described in
the project specification and public documentation only. Product names mentioned anywhere in this
project belong to their owners.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

---

### En español (resumen)

OpenCatalog es una alternativa open source para crear catálogos en InDesign a partir de datos.
La versión 0.2.0 carga CSV, Excel y JSON, coloca campos de texto e imagen en el documento
y los mantiene sincronizados (Update document / Update panel), con recuento de colocaciones e informe de errores.
Para probarla: `npm install && npm run build`, luego en UXP Developer Tools → *Add Plugin* →
`dist/plugin/manifest.json` → *Load*.
