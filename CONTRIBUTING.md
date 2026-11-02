# Contributing to OpenCatalog

Thanks for helping! Issues, bug reports from real InDesign use, docs and code are all welcome.

## Clean-room rule (important)

OpenCatalog is an independent, clean-room implementation of data-driven catalog publishing.

- Do **not** copy code, decompiled output, UI text, icons, file formats, help pages or internal names
  from proprietary products, and do not contribute work derived from reverse engineering them.
- Base your work on the public behaviour described in this repository's docs, on public
  documentation of InDesign/UXP, and on your own design.
- Product names belong to their owners; avoid them in code, identifiers and UI.

By contributing you agree that your contribution is licensed under the Apache License 2.0.

## Development setup

```bash
npm install
npm run build        # dist/plugin (load in UXP Developer Tools) and dist/preview (browser)
npm run watch        # rebuild on save
npm run check        # typecheck + unit tests + build
npm run test:helper  # Python tests of tools/opencatalog-helper.py
npm run e2e          # browser end-to-end tests (needs Playwright with Chromium, and Python 3)
```

Open `dist/preview/index.html` to work on the panel without InDesign: it runs the same panel next to a
simulated document.

## Project layout

```
src/core/        data model, queries, links, sync, formats, expressions, pagination, versions (no InDesign)
src/providers/   CSV, XLSX, JSON, URL, Notion and SQL-helper sources
src/hosts/       InDesign (UXP DOM) adapter, browser host, in-memory document for tests/preview
src/ui/          the panel (plain DOM)
tools/           opencatalog-helper.py (local SQL helper)
test/            unit tests (Vitest), fixtures, e2e (Playwright)
docs/            user guide and InDesign test checklist
```

Guidelines:

- Keep `src/core` free of InDesign and DOM dependencies, and cover it with unit tests.
- Anything that touches the InDesign DOM goes through `DocumentAdapter` (`src/core/links.ts`), with a
  matching implementation in `src/hosts/memory-document.ts` so it can be tested.
- Behaviour that can only be checked inside InDesign belongs in `docs/indesign-test-checklist.md`.
- Strict TypeScript; no new runtime dependencies without a good reason.

## Pull requests

1. Fork and create a branch.
2. Make the change with tests; run `npm run check`.
3. If you changed InDesign-facing code, say in the PR which checklist items you ran in InDesign
   (version and OS).
