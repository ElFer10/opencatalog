# InDesign test checklist (phases 1–2)

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
