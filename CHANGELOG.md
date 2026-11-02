# Changelog

## 0.5.0 — Connections, versions, merged PDFs, scripting
- Remote sources: URL (JSON/CSV with auth header, record path and next-page links), Notion databases,
  SQL databases through `tools/opencatalog-helper.py` (SQLite built in, ODBC via pyodbc, read-only by default).
- Saved connections; tokens kept in UXP secure storage.
- Versions from field suffixes (`Name_sv` / `Name_es`, `Price (SE)`); version switch and a PDF per version.
- One PDF per record from a document that shows one record.
- Script console with an `oc` API.

## 0.4.1
- Fixed: in InDesign the record list overlapped the panel's buttons.
- Mac Roman CSV detection (Excel for Mac "CSV (Macintosh)") and an Encoding selector.

## 0.4.0 — Pagination and PDF
- Template pagination over new pages, page breaks per group.
- Text-flow pagination with headings, threaded frames and optional `OC …` paragraph styles.
- PDF export with presets.

## 0.3.0 — Layout tools
- Field formats, computed fields (expression language), image URLs with a cache.
- Linked tables, Repeat layout, new/changed/deleted tracking on reload.

## 0.2.0 — Place and sync
- Place text and image fields; links stored in the document.
- Update Document, Update Panel, placement counts, error report, CSV export.

## 0.1.0 — Data sources and panel
- CSV/TXT/TSV, XLSX and JSON sources; search, filters, sort, grouping, field visibility.
