// Builds the UXP plugin into dist/plugin and the browser preview into dist/preview.
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const css = () => readFileSync("src/ui/styles.css", "utf8");

const page = (title, script, extra = "") => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
html, body { margin: 0; padding: 0; height: 100%; }
#app { height: 100%; }
${css()}
</style>
</head>
<body>
${extra}
<div id="app"></div>
<script src="${script}"></script>
</body>
</html>
`;

function writeStatic() {
  mkdirSync("dist/plugin", { recursive: true });
  mkdirSync("dist/preview", { recursive: true });
  copyFileSync("plugin/manifest.json", "dist/plugin/manifest.json");
  writeFileSync("dist/plugin/index.html", page("OpenCatalog", "main.js"));
  writeFileSync(
    "dist/preview/index.html",
    page(
      "OpenCatalog preview",
      "preview.js",
      `<div class="pv-banner">Browser preview (no InDesign).
<button id="demo">Load demo data</button>
<button id="demo2" title="Simulates editing the data file and pressing Reload">Load demo with changed prices</button></div>
<style>
.pv-banner { padding: 6px 8px; font: 12px system-ui; background: #fffbe6; border-bottom: 1px solid #e6d98c; }
body { display: flex; flex-direction: column; }
.pv-wrap { display: flex; height: calc(100% - 34px); }
#app { width: 58%; height: 100%; border-right: 1px solid #ccc; }
#doc { flex: 1; overflow: auto; font: 12px system-ui; background: #e8e8e8; }
.pv-toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 8px; background: #fafafa; border-bottom: 1px solid #ccc; }
.pv-page { position: relative; margin: 12px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
.pv-margins { position: absolute; border: 1px solid #e4b4f0; pointer-events: none; }
.pv-frame { position: absolute; box-sizing: border-box; border: 1px dashed #9ab; padding: 2px 4px; cursor: pointer; background: rgba(255,255,255,.85); overflow: hidden; }
.pv-table { border-collapse: collapse; font: 11px Georgia, serif; width: 100%; }
.pv-table td, .pv-table th { border: 1px solid #bbb; padding: 1px 3px; text-align: left; }
.pv-frame.pv-linked { border-style: solid; }
.pv-frame.pv-sel { outline: 2px solid #1473e6; }
.pv-frame-head { font-size: 10.5px; color: #666; display: flex; gap: 6px; align-items: center; margin-bottom: 2px; }
.pv-badge { background: #e3f0ff; color: #1473e6; border-radius: 3px; padding: 0 4px; }
.pv-mini { font-size: 10px; padding: 0 4px; }
.pv-text { white-space: pre-wrap; font: 12px Georgia, serif; }
.pv-field { background: #e3f0ff; border-bottom: 1px solid #1473e6; }
.pv-img { padding: 8px; text-align: center; background: #f2f2f2; color: #555; font-size: 10px; word-break: break-all; }
.pv-muted { color: #888; }
</style>`,
    ).replace('<div id="app"></div>', '<div class="pv-wrap"><div id="app"></div><div id="doc"></div></div>'),
  );
}

const common = { bundle: true, format: "iife", target: "es2019", logLevel: "info", legalComments: "none" };
const configs = [
  { ...common, entryPoints: ["src/main-uxp.ts"], outfile: "dist/plugin/main.js", external: ["uxp", "indesign"] },
  { ...common, entryPoints: ["src/main-browser.ts"], outfile: "dist/preview/preview.js" },
];

writeStatic();
if (watch) {
  for (const c of configs) await (await context(c)).watch();
  console.log("Watching… (re-run to refresh index.html after CSS changes)");
} else {
  await Promise.all(configs.map((c) => build(c)));
}
