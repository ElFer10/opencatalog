const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto("file://" + require("path").resolve(__dirname, "../../dist/preview/index.html"));
  await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.click('#demo3');
  const state = () => p.evaluate(() => { const d = window.opencatalog.doc; return { pages: d.pageCount, frames: d.frames.length, keys: d.scan().map(i => i.link.key), exported: d.exported }; });
  // Template: group by Category, place Product + Image for the first record, select both, paginate all with page breaks.
  await p.locator('.oc-controls select').last().selectOption('Category');
  await p.click('.oc-rec[data-id="P-001"]');
  await p.locator('.oc-docbar select').first().selectOption('Product');
  await p.click('text=Place field');
  await p.click('text=Deselect');
  await p.locator('.oc-docbar select').first().selectOption('Image');
  await p.click('text=Place image');
  const ids = await p.evaluate(() => window.opencatalog.doc.frames.map(f => f.id));
  await p.click(`[data-frame="${ids[0]}"]`);
  await p.click(`[data-frame="${ids[1]}"]`, { modifiers: ['Shift'] });
  await p.click('text=Paginate…');
  await p.locator('.oc-paginate input[type=checkbox]').check();
  await p.click('.oc-paginate >> text=Paginate');
  let st = await state();
  const msg = await p.textContent('.oc-status');
  assert(msg.includes('Paginated 56 records'), msg);
  assert(st.keys.length === 112, 'links ' + st.keys.length); // 56 × (Product + Image)
  assert(new Set(st.keys).size === 56, 'unique records');
  assert(st.pages >= 6, 'pages ' + st.pages); // 3 categories × ≥2 pages each (21 records, 8 per page)
  const texts = await p.evaluate(() => window.opencatalog.doc.frames.filter(f => f.kind === 'text').map(f => f.runs.map(r => r.text).join('')));
  assert(texts[0] === 'Coffee no. 1' && texts.includes('Herbs no. 7'), 'filled ' + texts.slice(0, 3));
  // Page breaks: first record of Oils starts a page alone at the top-left slot of its page.
  const oilsPage = await p.evaluate(() => { const d = window.opencatalog.doc; const f = d.frames.find(x => x.runs.some(r => r.text === 'Olive no. 1')); return [f.page, f.bounds[0], f.bounds[1]]; });
  assert(oilsPage[1] === 12 && oilsPage[2] === 12, 'oils at top-left ' + oilsPage);
  await p.screenshot({ path: '/tmp/oc-h1-template.png' });
  // Flow: new document state, headings by Category › Subcategory
  await p.evaluate(() => { const d = window.opencatalog.doc; d.frames = []; d.pageCount = 1; d.selection = null; d.onChange(); });
  await p.locator('.oc-controls select').last().selectOption('Subcategory');
  await p.locator('.oc-paginate select').first().selectOption('flow');
  await p.locator('.oc-paginate select').nth(2).selectOption('tab');
  await p.click('.oc-paginate >> text=Paginate');
  st = await state();
  const msg2 = await p.textContent('.oc-status');
  assert(msg2.includes('Flowed 56 records'), msg2);
  assert(st.keys.length === 56 * 4, 'flow links ' + st.keys.length); // SKU, Product, Price, Unit (group fields become headings)
  const story = await p.evaluate(() => window.opencatalog.doc.frames[0].runs.map(r => r.text).join(''));
  assert(story.startsWith('Drinks\rCoffee\rP-001\tCoffee no. 1\t'), 'flow start ' + JSON.stringify(story.slice(0, 50)));
  assert(st.pages === 2, 'flow pages ' + st.pages); // 56 records + 3 + 8 headings = 67 lines → 2 pages
  await p.screenshot({ path: '/tmp/oc-h2-flow.png' });
  // PDF
  await p.click('text=Export PDF…');
  st = await state();
  assert(st.exported.length === 1 && st.exported[0].path.endsWith('.pdf'), 'pdf ' + JSON.stringify(st.exported));
  console.log(JSON.stringify({ ok: true, msg, msg2, pages: st.pages, errs }));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
