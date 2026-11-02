# InDesign test checklist (phases 1–4)

The core is unit-tested and the panel is tested in the browser preview, but the InDesign
adapter (`src/hosts/indesign.ts`) can only be verified inside InDesign. Run through this list
after loading the plugin with UXP Developer Tools, and note anything that fails.

Use the demo CSV from `test/fixtures/productos-eu.csv` or any small file with a `SKU` column.

1. **Open data** — Open a CSV and an .xlsx. The list fills; the file is remembered after
   reloading the plugin.
2. **Place at cursor** — Type `Price: ` in a text frame, leave the cursor after it, select a record,
   choose `Price`, click **Place field**. The value appears after the text.
   In *Window › Utilities › Tags / Structure* the value is wrapped in `oc_field`.
3. **Place into frame** — Select a text frame with the selection tool, place a field. The frame
   contents are replaced by the value.
4. **New frame** — Deselect all (Cmd+Shift+A), place **visible fields** for two records. A new
   frame appears on the active page with one paragraph per field.
5. **Image** — Choose an image folder, select an empty rectangle, choose an image field, click
   **Place image**. The image is placed and fitted.
6. **Update document** — Change a value in the data file, click **Reload**, then
   **Update document**. Fields change; *Edit › Undo* reverts the whole update in one step.
7. **Update panel** — Edit the text of a placed field in the document, click **Update panel**.
   The cell is highlighted; **Save as CSV…** writes a file.
8. **Errors** — Delete a record from the data, reload, update. The report lists the missing
   record; clicking it selects the item in the document.
9. **Count / Show placed** — Click **Count**; the `#` column shows placements; filter by
   *placed* / *not placed*.
10. **Theme** — Switch InDesign between light and dark interface; text stays readable.

If something fails, open UXP Developer Tools › *Debug* for the plugin and copy the console error.

## Phase 2

11. **Formats** — Give `Price` 2 decimals, a space as thousands separator and suffix ` kr`; Update
    document. Placed prices change to e.g. `1 299,50 kr`.
12. **Computed field** — Add `Label = upper({Product}) & " – " & {Unit}`, place it, change a product
    name in the data, Reload, Update document.
13. **Image URL** — Use a field with an `https://` image address and **Place image**. The first time,
    InDesign may ask to allow network access for the plugin.
14. **Table** — Select 3 records, **Place as table** with nothing selected. Edit the data, Reload,
    Update document: the cells change and the table keeps its formatting.
15. **Repeat layout** — Build a block (name frame + image frame) for one record, select both frames
    with the selection tool, select 4 records, **Repeat layout**. Copies appear in a grid, filled
    with each record's data; Edit › Undo removes them in one step.
16. **Synchronize** — Add, change and delete rows in the data file, Reload. The status line counts
    them, changed cells are highlighted, and placed fields of deleted rows are listed in the report.

## Phase 3

17. **Template pagination** — Load a file with 30+ records, group by a category, build a block for
    one record, select it, open **Paginate…**, tick *new page for each …* and click **Paginate**.
    Pages are added, each category starts on a new page, every copy shows its record, and
    Edit › Undo removes the whole pagination.
18. **Facing pages** — Repeat 17 in a document with facing pages; check whether copies on left pages
    respect the margins (known limit: they use the template page's margins).
19. **Flow pagination** — Create paragraph styles `OC Heading 1`, `OC Heading 2` and `OC Record`
    (with tab stops). Group by two fields, choose *Text flow*, separator *tab*, and **Paginate**
    with nothing selected. Headings and records use the styles; pages with threaded frames are
    added until nothing overflows.
20. **Update after pagination** — Change prices in the data, Reload, **Update document**: the
    paginated pages update in place.
21. **PDF** — Choose a preset and **Export PDF…**; the PDF opens correctly.

## Phase 4

22. **URL source** — Connect… › URL, a public JSON or CSV link. The first time, InDesign may ask
    to allow network access. Reload fetches again.
23. **Notion** — Create an integration at notion.so/my-integrations, share the recipe database
    with it, Connect… › Notion database with the link and token. Fields appear with the title first.
24. **SQL helper** — Run `python3 tools/opencatalog-helper.py`, paste the token, connection
    `sqlite:/path/to/file.db`, query `SELECT * FROM …`. Try an `UPDATE`: it must be refused.
25. **Versions** — Data with `Namn_sv` / `Namn_es`: place `Namn`, switch Version to `es`,
    Update document; then **PDF for each version** writes one PDF per language.
26. **One PDF per record** — A document showing one recipe; Paginate… › One PDF per record, named
    by `Namn`. One PDF per recipe appears and the document ends showing the original recipe.
27. **Script** — Script… › `oc.log(oc.records().length)` › Run. Then something using
    `oc.indesign`, e.g. `oc.log(oc.indesign.app.activeDocument.pages.length)`.
