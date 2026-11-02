const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto("file://" + require("path").resolve(__dirname, "../../dist/preview/index.html"));
  await p.click('#demo');
  const story = (id) => p.evaluate((id) => { const d = window.opencatalog.doc; return d.frames.find(f => f.id === id).runs.map(r => r.text).join(''); }, id);
  const status = () => p.textContent('.oc-status');
  // 1. place price at a text cursor
  await p.click('.oc-rec[data-id="A-001"]');
  await p.click('text=+ Text frame');
  await p.locator('.oc-docbar select').first().selectOption('Price');
  await p.click('text=Place field');
  assert((await story(1)) === 'Price: 4,95', 'inline place ' + await story(1));
  // 2. two records, visible fields, new frame
  await p.click('text=Deselect');
  await p.click('.oc-rec[data-id="A-010"]', { modifiers: ['Control'] });
  await p.click('text=Place visible fields');
  const s2 = await story(2);
  assert(s2.startsWith('A-001\rGround coffee\rDrinks\rCoffee\r4,95\r500 g\rA-010\rGreen tea'), 'multi ' + JSON.stringify(s2));
  // 3. image field for A-010 into new graphic frame
  await p.click('text=Deselect');
  await p.click('.oc-rec[data-id="A-010"]');
  await p.locator('.oc-docbar select').first().selectOption('Image');
  await p.click('text=Place image');
  const img = await p.evaluate(() => window.opencatalog.doc.frames[2].image);
  assert(img === '/Users/me/catalog/green-tea.jpg', 'image ' + img);
  await p.screenshot({ path: '/tmp/oc-f1-placed.png' });
  // 4. changed data + update document
  await p.click('#demo2');
  await p.click('text=Update document');
  const rep = await p.textContent('.oc-report');
  assert(rep.includes('Update document: 3 fields updated'), 'report ' + rep);
  assert((await story(1)) === 'Price: 5,25', 'updated inline');
  assert((await story(2)).includes('Sencha green tea'), 'updated multi');
  // 5. edit in document, update panel
  await p.evaluate(() => { const d = window.opencatalog.doc; d.editText({ frameId: 1, run: 1 }, '5,49'); });
  await p.click('text=Update panel');
  const rep2 = await p.textContent('.oc-report');
  assert(rep2.includes('1 value taken from the document'), 'panel ' + rep2);
  assert(await p.locator('.oc-edited').count() === 1, 'edited cell');
  // 6. counts and placed filter, error report for deleted record
  await p.click('text=Count');
  const g = await p.textContent('.oc-rec[data-id="A-001"] .oc-gutter');
  assert(g === '7', 'count A-001 ' + g);
  await p.locator('.oc-docbar select').nth(1).selectOption('placed');
  const placed = await status();
  assert(placed.startsWith('2 of 8'), 'placed filter ' + placed);
  await p.screenshot({ path: '/tmp/oc-f2-updated.png' });
  await p.evaluate(() => window.opencatalog.panel.openPicked({ name: 'demo-products.csv', bytes: new TextEncoder().encode('SKU;Product;Category;Subcategory;Price;Unit;Image\nA-001;Ground coffee;Drinks;Coffee;4,95;500 g;coffee.jpg'), token: 'demo', path: '/Users/me/catalog/demo-products.csv' }, undefined, true));
  await p.click('text=Update document');
  const rep3 = await p.textContent('.oc-report');
  assert(rep3.includes('error'), 'errors ' + rep3);
  await p.locator('.oc-issue').first().click();
  const selFrame = await p.evaluate(() => window.opencatalog.doc.selection);
  await p.screenshot({ path: '/tmp/oc-f3-errors.png' });
  console.log(JSON.stringify({ ok: true, rep, rep2, rep3, selFrame, errs }));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
