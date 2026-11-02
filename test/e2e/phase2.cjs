const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto("file://" + require("path").resolve(__dirname, "../../dist/preview/index.html"));
  await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.click('#demo');
  const frames = () => p.evaluate(() => window.opencatalog.doc.frames.map(f => ({ id: f.id, kind: f.kind, text: f.runs.map(r => r.text).join(''), image: f.image, table: f.table })));
  // 1. formats + computed field
  await p.click('.oc-controls >> text=Fields');
  const priceRow = p.locator('.oc-fieldrow', { hasText: 'Price' });
  await priceRow.locator('text=Format…').click();
  const fmt = p.locator('.oc-format');
  await fmt.locator('input').nth(1).fill(' kr'); await fmt.locator('input').nth(1).press('Tab');
  await p.locator('.oc-format input[type=number]').fill('2'); await p.locator('.oc-format input[type=number]').press('Tab');
  await p.locator('.oc-computed input').nth(0).fill('Label');
  await p.locator('.oc-computed input').nth(1).fill('upper({Product}) & " – " & {Unit}');
  await p.click('.oc-computed >> text=+ Add');
  await p.screenshot({ path: '/tmp/oc-g0-fields.png' });
  const cell = await p.textContent('.oc-rec[data-id="A-001"] .oc-td:nth-child(6)');
  assert(cell === '4,95 kr', 'formatted cell ' + cell);
  await p.click('.oc-controls >> text=Fields');
  // 2. place computed field and formatted price
  await p.click('.oc-rec[data-id="A-001"]');
  await p.locator('.oc-docbar select').first().selectOption('Label');
  await p.click('text=Place field');
  let fr = await frames();
  assert(fr[0].text === 'GROUND COFFEE – 500 g', 'computed placed ' + fr[0].text);
  // 3. URL image
  await p.click('text=Deselect');
  await p.locator('.oc-docbar select').first().selectOption('Image');
  await p.click('text=Place image');
  fr = await frames();
  assert(/^\/cache\/[0-9a-f]{8}-\d+\.jpg$/.test(fr[1].image), 'url image ' + fr[1].image);
  // 4. repeat layout: select both A-001 frames, records A-001, A-002, A-010, B-001
  await p.click(`[data-frame="${fr[0].id}"]`);
  await p.click(`[data-frame="${fr[1].id}"]`, { modifiers: ['Shift'] });
  for (const id of ['A-002', 'A-010', 'B-001']) await p.click(`.oc-rec[data-id="${id}"]`, { modifiers: ['Control'] });
  await p.click('text=Repeat layout');
  fr = await frames();
  assert(fr.length === 8, 'repeat frames ' + fr.length);
  const texts = fr.filter(f => f.kind === 'text').map(f => f.text);
  assert(texts.includes('ESPRESSO BEANS – 1 kg') && texts.includes('EXTRA VIRGIN OLIVE OIL – 750 ml'), 'repeat texts ' + texts);
  const imgs = fr.filter(f => f.kind === 'graphic').map(f => f.image);
  assert(imgs.includes('/Users/me/catalog/olive-oil.jpg'), 'repeat images ' + imgs);
  const status1 = await p.textContent('.oc-status');
  assert(status1.includes('Repeated the layout of A-001 for 3 records'), status1);
  await p.screenshot({ path: '/tmp/oc-g1-repeat.png' });
  // 5. table
  await p.click('text=Deselect');
  await p.click('.oc-rec[data-id="A-001"]');
  await p.click('.oc-rec[data-id="A-011"]', { modifiers: ['Shift'] });
  await p.click('text=Place as table');
  fr = await frames();
  const t = fr.at(-1).table; if (!t) console.log('STATUS', await p.textContent('.oc-status'), JSON.stringify(fr.at(-1)));
  assert(t && t.header.includes('Label') && t.rows.length === 4 && t.rows[0][4].text === '4,95 kr', 'table ' + JSON.stringify(t && t.rows[0]));
  // 6. synchronize: reload changed data (keepState) → diff + update
  const changed = await p.evaluate(() => {
    const src = ["SKU;Product;Category;Subcategory;Price;Unit;Image",
      "A-001;Ground coffee;Drinks;Coffee;5,25;500 g;https://images.example.com/coffee.jpg",
      "A-002;Espresso beans;Drinks;Coffee;7,50;1 kg;espresso.jpg",
      "A-010;Sencha green tea;Drinks;Tea;3,50;100 g;green-tea.jpg",
      "A-011;Rooibos;Drinks;Tea;3,20;100 g;rooibos.jpg",
      "B-001;Extra virgin olive oil;Oils;Olive;12,00;750 ml;olive-oil.jpg",
      "B-003;Walnut oil;Oils;Seed;9,90;250 ml;walnut.jpg",
      "C-001;Sea salt;Spices;Salt;1,90;500 g;salt.jpg"].join("\n");
    window.opencatalog.panel.openPicked({ name: 'demo-products.csv', bytes: new TextEncoder().encode(src), token: 'demo', path: '/Users/me/catalog/demo-products.csv' }, undefined, true);
    return document.querySelector('.oc-status').textContent;
  });
  assert(changed.includes('1 new') && changed.includes('2 changed') && changed.includes('2 deleted'), 'diff ' + changed);
  assert(await p.locator('.oc-changed').count() >= 2, 'changed cells');
  await p.locator('.oc-docbar select').nth(1).selectOption('changed');
  const st = await p.textContent('.oc-status');
  assert(st.startsWith('2 of 7'), 'changed filter ' + st);
  await p.screenshot({ path: '/tmp/oc-g2-sync.png' });
  await p.click('text=Update document');
  const rep = await p.textContent('.oc-report');
  fr = await frames();
  const tbl = fr.find(f => f.kind === 'table').table;
  assert(tbl.rows[0][4].text === '5,25 kr', 'table cell updated ' + tbl.rows[0][4].text);
  assert(fr.some(f => f.text === 'SENCHA GREEN TEA – 100 g'), 'computed updated');
  console.log(JSON.stringify({ ok: true, rep, changed, errs }));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
