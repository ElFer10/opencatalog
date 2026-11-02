# OpenCatalog

Open-source, data-driven catalog publishing for Adobe InDesign, built as a UXP plugin.

> Status: **phase 0 (0.1.0)** — load a data source and browse it in an InDesign panel.
> Placing fields on the page and updating the document come in phase 1.

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

The same panel runs in a browser without InDesign, which is handy for UI work:
open `dist/preview/index.html` after `npm run build` and click **Load demo data**,
or open any CSV/XLSX/JSON file.

## Development

```bash
npm run typecheck   # TypeScript, strict
npm test            # Vitest unit tests (core + providers)
npm run check       # all of the above + build
```

```
src/
  core/        data model, filters, sort, grouping — no InDesign dependency
  providers/   CSV, XLSX (via fflate), JSON parsers → DataSource
  ui/          the panel (plain DOM, no framework)
  hosts/       environment adapters: UXP (InDesign) and browser preview
plugin/        UXP manifest
test/          unit tests and fixtures
```

## Roadmap

| Phase | Scope |
| --- | --- |
| 0 — Base | Data sources, panel with search, filters, sort and grouping ✅ |
| 1 — MVP | Place text and image fields, store links in the document, Update Document / Update Panel, place count and error report |
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
Esta versión 0.1.0 carga CSV, Excel y JSON en un panel con búsqueda, filtros, orden y agrupación.
Para probarla: `npm install && npm run build`, luego en UXP Developer Tools → *Add Plugin* →
`dist/plugin/manifest.json` → *Load*.
