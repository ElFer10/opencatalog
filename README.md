# OpenCatalog

Open-source, data-driven catalog publishing for Adobe InDesign, built as a UXP plugin.

> Status: **phase 4 (0.5.0)** — files and remote sources (REST/JSON/CSV URLs, Notion, SQL via a
> local helper), placing and two-way sync, layout tools, pagination, versions per language/market,
> one PDF per record, and scripting.

## What works today

- Data sources: **CSV / TXT / TSV** (delimiter detection, quoted fields, decimal commas,
  UTF-8 with or without BOM, UTF-16, Windows-1252 and Mac Roman detection — Excel for Mac's
  "CSV (Macintosh)" — with a manual **Encoding** override in the panel), **Excel .xlsx** (all sheets, dates, booleans,
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

### Layout tools (phase 2)

- **Field formats** (Fields › Format…): prefix, suffix, text for empty values, UPPER/lower/Title case;
  for numbers fixed decimals and a thousands separator (space, thin space, point, comma, apostrophe);
  for dates a pattern such as `DD.MM.YYYY` or `D MMMM YYYY` with a locale for month names (`sv-SE`).
  The grid shows values as they will appear in the document. Update Panel reverses number formats.
- **Computed fields** (Fields › Computed fields): a small expression language evaluated per record.
  ```
  {Price} * 1.25
  upper({Product}) & " – " & {Unit}
  if({Stock} > 0, "In stock", "Sold out")
  round({Price} * 0.8, 2)      join(", ", {Color}, {Size})
  ```
  Operators `+ - * / %`, `&` joins text, `= <> < <= > >=`, `and or not`. Functions: abs, ceil,
  coalesce, concat, contains, floor, if, isempty, join, left, len, lower, max, mid, min, number,
  replace, right, round, startswith, text, trim, upper. Computed fields can use earlier computed
  fields, are placed like any other field and are read-only for Update Panel.
- **Image URLs**: `http(s)://` values are downloaded into the plugin's image cache and placed from
  there (once per URL per session; cached files are reused).
- **Place as table**: one row per selected record, one column per visible text field, optional
  header row. Every cell stays linked and is refreshed by Update Document.
- **Repeat layout**: design one product block (frames showing fields of a single record — text,
  images, tables), select it with the selection tool, select records in the list and click
  **Repeat layout**. The block is copied in a grid inside the page margins (gap configurable), each
  copy re-linked to its record and filled. Records that do not fit are reported; flowing onto new
  pages comes with pagination in phase 3.
- **Synchronize**: on Reload, the panel compares the new data with the previous load and reports
  new, changed and deleted records (and added/removed fields). Changed cells are highlighted,
  **Show: new / changed** filters the list, and placed fields of deleted records are listed.

### Pagination and PDF (phase 3)

Open **Paginate…** in the panel. Records are taken in list order — so filters, sorting and
grouping decide what goes where — either all records in view or only the selected ones.

- **Template mode**: build one product block (any frames showing fields of one record), select it
  with the selection tool and click **Paginate**. The block becomes the first record and is copied
  in a grid over as many pages as needed (new pages use the template page's parent/master), then
  every copy is filled. With the list grouped, **new page for each …** starts every value of the
  first group field on a fresh page.
- **Text flow mode**: each record becomes one paragraph (fields separated by tabs or paragraph
  breaks) in one threaded story; with the list grouped, a heading paragraph is written whenever a
  group value changes. Start from a selected text frame, a text cursor, or nothing (a frame filling
  the page margins is created). Pages and threaded frames are added until nothing overflows.
  Paragraph styles named **OC Heading 1**, **OC Heading 2**, … and **OC Record** are applied when the
  document has them — define those styles (tabs, sizes, spacing) to design the flowed catalogue.
- Every placed field stays linked, so **Update document** keeps the paginated catalogue current.
- **Export PDF…** exports the document with a PDF preset chosen in the pagination box.

Known limits: template copies use the margins of the template's page for every page (mirrored
inside/outside margins on facing pages are not yet handled); flow mode does not yet handle
inline images or keep records together across frame breaks.

### Connections, versions, merged PDFs and scripting (phase 4)

- **Connect…** loads data from somewhere other than a file. Connections are saved by name; tokens
  are kept in UXP secure storage, never in the plain settings. **Reload** fetches again (with the
  usual new/changed/deleted comparison).
  - **URL (JSON / CSV)** — any REST endpoint or export link. Optional header with `{token}`
    (e.g. `Authorization: Bearer {token}`), the path to the record list (`data.items`) and the
    path to the next-page link (`links.next`) for paginated APIs.
  - **Notion database** — paste the database link and an internal integration token, and share the
    database with the integration. Titles, text, numbers, selects, multi-selects, dates, files
    (as URLs), formulas, rollups, relations and unique IDs become fields.
  - **SQL database** — through `tools/opencatalog-helper.py`, a small local server (Python standard
    library) that the panel calls, because UXP plugins cannot open database connections.
    ```bash
    python3 tools/opencatalog-helper.py           # prints the token to paste into the panel
    ```
    Connection `sqlite:/path/to/catalog.db` works out of the box; `odbc:DSN=…;UID=…;PWD=…` needs
    `pip install pyodbc` and an ODBC driver (SQL Server, MySQL, PostgreSQL, FileMaker…). The helper
    listens only on 127.0.0.1, requires the token and accepts only SELECT/WITH queries unless it
    is started with `--allow-write`.
- **Versions**: fields such as `Namn_sv` / `Namn_es` or `Price (SE)` / `Price (ES)` are detected as
  versions of `Namn` / `Price` (a code must be used by at least two fields). A missing base field
  is added so it can be placed. Choose **Version** in the toolbar and Update document; **PDF for each
  version** updates and exports the document once per version (`document-sv.pdf`, `document-es.pdf`).
  Update Panel writes edits back to the version's own field.
- **One PDF per record** (in Paginate…): design a document that shows one record — a recipe card,
  a product sheet, a price label — and export it for every record in the list (or the selected
  ones), named by a field of your choice. The document is restored to its original record at the end.
- **Script…** runs JavaScript in the panel with an `oc` object: `oc.records()` (list order),
  `oc.all()`, `oc.fields`, `oc.selected()`, `oc.select(ids)`, `oc.versions`, `oc.setVersion(v)`,
  `await oc.updateDocument(ids?)`, `await oc.placeFields(fields)`, `await oc.paginate()`,
  `oc.exportPdf(path, preset?)`, `oc.document`, `oc.indesign` (the UXP InDesign DOM) and `oc.log()`.
  Scripts are saved per data source.

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
npm run e2e         # browser end-to-end tests of the preview (needs Playwright + Chromium, Python 3)
npm run test:helper # unit tests of the SQL helper
```

```
src/
  core/        data model, filters, sort, grouping, links and sync engine — no InDesign dependency
  providers/   CSV, XLSX (via fflate), JSON parsers → DataSource
  ui/          the panel (plain DOM, no framework)
  hosts/       environment adapters: UXP + InDesign DOM, browser preview, in-memory document
plugin/        UXP manifest
tools/         opencatalog-helper.py (local SQL helper) and its tests
test/          unit tests and fixtures
```

## Roadmap

| Phase | Scope |
| --- | --- |
| 0 — Base | Data sources, panel with search, filters, sort and grouping ✅ |
| 1 — MVP | Place text and image fields, store links in the document, Update Document / Update Panel, place count and error report ✅ |
| 2 — Layout | Computed fields, number formats, images from URLs, repeated layout blocks, linked tables, synchronize (new/changed/deleted) ✅ |
| 3 — Pagination | Template and text-flow pagination, page breaks per group, page insertion, PDF export ✅ (guide/master/position modes later) |
| 4 — Advanced | Local helper for ODBC/SQLite, REST/URL and Notion connectors, versions, one PDF per record, scripting ✅ |

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
La versión 0.5.0 carga archivos (CSV, Excel, JSON) y fuentes remotas (URL/REST, Notion y bases SQL
mediante un pequeño helper local), coloca campos y los mantiene sincronizados, pagina, exporta a PDF,
gestiona versiones por idioma o mercado, genera un PDF por registro y permite automatizar con scripts.
Añade formatos de campo, campos calculados con expresiones, imágenes desde URL, tablas vinculadas,
repetición de un bloque de producto por registro y detección de registros nuevos, cambiados y borrados.
Para probarla: `npm install && npm run build`, luego en UXP Developer Tools → *Add Plugin* →
`dist/plugin/manifest.json` → *Load*.
