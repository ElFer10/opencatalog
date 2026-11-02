// Creates a SQLite menu database, starts tools/opencatalog-helper.py, and drives the preview.
const { chromium } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const DB = path.join(os.tmpdir(), 'oc-menu.db');
execFileSync('python3', ['-c', `
import sqlite3
con = sqlite3.connect(${JSON.stringify(DB)}); con.execute('DROP TABLE IF EXISTS meny')
con.execute('CREATE TABLE meny (id TEXT, Namn_sv TEXT, Namn_es TEXT, Beskrivning_sv TEXT, Beskrivning_es TEXT, Pris REAL)')
con.executemany('INSERT INTO meny VALUES (?,?,?,?,?,?)', [
  ('D1','Blåbärsmousse','Mousse de arándanos','Med vispad grädde','Con nata montada',95),
  ('D2','Chokladsorbet','Sorbete de chocolate','Mörk choklad','Chocolate negro',85),
  ('S1','Surdegsbröd','Pan de masa madre','Bakat i huset','Horneado en casa',30)])
con.commit()`]);
const helper = spawn('python3', [path.resolve(__dirname, '../../tools/opencatalog-helper.py'), '--port', '8799', '--token', 'e2e-token'], { stdio: 'ignore' });
process.on('exit', () => helper.kill());
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  await new Promise((r) => setTimeout(r, 800)); // helper start-up
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept('/Users/me/Desktop/out'));  // pickFolder uses a prompt in the preview
  await p.goto("file://" + require("path").resolve(__dirname, "../../dist/preview/index.html"));
  await p.evaluate(() => localStorage.clear()); await p.reload();
  // 1. SQL connection through the helper
  await p.click('text=Connect…');
  await p.locator('.oc-connect select').first().selectOption('sql');
  const inputs = p.locator('.oc-connect input');
  await inputs.nth(0).fill('Meny');                       // name
  await inputs.nth(1).fill('http://127.0.0.1:8799');     // helper
  await inputs.nth(2).fill('e2e-token');                  // token
  await inputs.nth(3).fill('sqlite:' + DB);               // connection
  await p.locator('.oc-connect textarea').fill('SELECT * FROM meny ORDER BY id');
  await p.click('text=Connect and save');
  await p.waitForFunction(() => document.querySelector('.oc-source')?.textContent?.includes('Meny (SQL)'));
  const status = await p.textContent('.oc-status');
  assert(status.startsWith('3 records'), 'sql load ' + status);
  // 2. Versions: Namn is added as a base field; switch to es
  const versionSel = p.locator('.oc-toolbar label:has-text("Version") + select');
  const vopts = (await versionSel.locator('option').allTextContents()).join('|'); assert(vopts === 'default (sv)|sv|es', 'versions ' + vopts);
  await p.click('.oc-rec[data-id="D1"]');
  await p.locator('.oc-docbar select').first().selectOption('Namn');
  await p.click('text=Place field');
  const text = () => p.evaluate(() => window.opencatalog.doc.frames.map(f => f.runs.map(r => r.text).join('')));
  assert((await text())[0] === 'Blåbärsmousse', 'sv placed');
  await versionSel.selectOption('es');
  await p.click('text=Update document');
  assert((await text())[0] === 'Mousse de arándanos', 'es updated ' + (await text())[0]);
  // 3. PDF for each version, then one PDF per record
  await p.click('text=Paginate…');
  await p.click('text=PDF for each version');
  await p.waitForFunction(() => window.opencatalog.doc.exported.length === 2);
  let exported = await p.evaluate(() => window.opencatalog.doc.exported.map(e => e.path));
  assert(exported.join('|') === '/Users/me/Desktop/out/Preview document-sv.pdf|/Users/me/Desktop/out/Preview document-es.pdf', 'per version ' + exported);
  assert((await text())[0] === 'Mousse de arándanos', 'version restored');
  await p.locator('.oc-paginate select').nth(2).selectOption('Namn');
  await p.click('text=One PDF per record');
  await p.waitForFunction(() => window.opencatalog.doc.exported.length === 5);
  exported = await p.evaluate(() => window.opencatalog.doc.exported.slice(2).map(e => e.path.split('/').pop()));
  assert(exported.join('|') === 'Mousse de arándanos.pdf|Sorbete de chocolate.pdf|Pan de masa madre.pdf', 'per record ' + exported);
  const keys = await p.evaluate(() => window.opencatalog.doc.scan().map(i => i.link.key));
  assert(keys.join() === 'D1' && (await text())[0] === 'Mousse de arándanos', 'restored to template record');
  // 4. Script
  await p.click('text=Script…');
  await p.locator('.oc-script').fill('const r = oc.records().filter(x => x.values.Pris < 90); oc.select(r.map(x => x.id)); oc.log(oc.fields.length, r.map(x => x.values.Namn)); return oc.selected().length;');
  await p.click('.oc-scriptbox >> text=Run');
  await p.waitForFunction(() => document.querySelector('.oc-output')?.textContent?.includes('→'));
  const out = await p.textContent('.oc-output');
  assert(out.includes('["Sorbete de chocolate","Pan de masa madre"]') && out.includes('→ 2'), 'script ' + out);
  await p.locator('.oc-script').fill('throw new Error("boom")');
  await p.click('.oc-scriptbox >> text=Run');
  await p.waitForFunction(() => document.querySelector('.oc-output')?.textContent?.includes('Error: boom'));
  await p.screenshot({ path: '/tmp/oc-i1-phase4.png' });
  // 5. Saved connection survives a reload of the page (secret is in memory only in the preview)
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('opencatalog.settings.v1')).remotes.map(r => r.name + ':' + r.type));
  assert(saved.join() === 'Meny:sql', 'saved ' + saved);
  const settingsText = await p.evaluate(() => localStorage.getItem('opencatalog.settings.v1'));
  assert(!settingsText.includes('e2e-token'), 'token not stored in plain settings');
  console.log(JSON.stringify({ ok: true, status, errs }));
  await b.close();
  helper.kill();
})().catch(e => { console.error(e.message); process.exit(1); });
