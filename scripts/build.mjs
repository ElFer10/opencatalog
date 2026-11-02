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
      `<div style="padding:6px 8px;font:12px system-ui;background:#fffbe6;border-bottom:1px solid #e6d98c">Browser preview (no InDesign). <button id="demo">Load demo data</button></div>
<style>#app { height: calc(100% - 34px); }</style>`,
    ),
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
