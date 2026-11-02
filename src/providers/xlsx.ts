/**
 * Minimal, dependency-light reader for Office Open XML spreadsheets (.xlsx).
 * Reads cell values only (shared strings, inline strings, numbers, booleans, dates by number format);
 * formulas are read from their cached values. Written from the public ECMA-376 format.
 */
import { strFromU8, unzipSync } from "fflate";
import type { Value } from "../core/model";
import { ParsedTable, tableFromMatrix } from "./table";

export interface XlsxWorkbook {
  sheetNames: string[];
  readSheet(name?: string): ParsedTable;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITY[e] ?? _;
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]!] = decodeXml(m[3] ?? m[4] ?? "");
  return out;
}

/** Concatenate the text of all <t> elements, ignoring phonetic runs. */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let s = "";
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) s += decodeXml(m[1] ?? "");
  return s;
}

/** "BC12" → 54 (zero-based column index). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, "");
  return /[dmyhs]/i.test(stripped) && !/^(general|@)$/i.test(stripped.trim());
}

/** Excel serial date → ISO string (date only when there is no time part). */
export function serialToIso(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86400000);
  const d = new Date(epoch + ms);
  const iso = d.toISOString();
  return ms % 86400000 === 0 ? iso.slice(0, 10) : iso.slice(0, 19);
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const p of target.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

export function openXlsx(bytes: Uint8Array): XlsxWorkbook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Not a valid .xlsx file (it could be an old .xls, which is not supported)");
  }
  const read = (p: string): string | null => {
    const f = files[p];
    return f ? strFromU8(f) : null;
  };

  const workbookXml = read("xl/workbook.xml");
  if (!workbookXml) throw new Error("Not a valid .xlsx file: xl/workbook.xml missing");
  const date1904 = /<workbookPr\b[^>]*date1904\s*=\s*"(1|true)"/i.test(workbookXml);

  const rels = new Map<string, string>();
  for (const m of (read("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a["Id"] && a["Target"]) rels.set(a["Id"], resolvePath("xl/workbook.xml", a["Target"]));
  }

  const sheets: { name: string; path: string }[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const rid = a["r:id"] ?? Object.entries(a).find(([k]) => k.endsWith(":id"))?.[1];
    const path = rid ? rels.get(rid) : undefined;
    if (a["name"] && path && files[path]) sheets.push({ name: a["name"], path });
  }
  if (sheets.length === 0) throw new Error("The workbook has no readable worksheets");

  const shared: string[] = [];
  const sstXml = read("xl/sharedStrings.xml");
  if (sstXml) for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(textOf(m[1] ?? ""));

  // Style index → is the cell formatted as a date?
  const dateStyles: boolean[] = [];
  const stylesXml = read("xl/styles.xml");
  if (stylesXml) {
    const custom = new Map<number, string>();
    for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
      const a = attrs(m[0]);
      if (a["numFmtId"] && a["formatCode"] !== undefined) custom.set(Number(a["numFmtId"]), a["formatCode"]);
    }
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
    for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
      const id = Number(attrs(m[0])["numFmtId"] ?? 0);
      const code = custom.get(id);
      dateStyles.push(code !== undefined ? isDateFormatCode(code) : BUILTIN_DATE_FORMATS.has(id));
    }
  }

  const readSheet = (name?: string): ParsedTable => {
    const sheet = name === undefined ? sheets[0]! : sheets.find((s) => s.name === name);
    if (!sheet) throw new Error(`Worksheet "${name}" not found`);
    const xml = read(sheet.path) ?? "";
    const data = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? "";
    const matrix: Value[][] = [];
    let nextRow = 0;
    for (const rm of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const ra = attrs(rm[1] ?? "");
      const rowIdx = ra["r"] ? Number(ra["r"]) - 1 : nextRow;
      nextRow = rowIdx + 1;
      const row: Value[] = [];
      let nextCol = 0;
      for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = attrs(cm[1] ?? "");
        const col = ca["r"] ? columnIndex(ca["r"]) : nextCol;
        nextCol = col + 1;
        const body = cm[2] ?? "";
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const t = ca["t"] ?? "n";
        let value: Value = null;
        if (t === "s") value = v !== undefined ? shared[Number(v)] ?? null : null;
        else if (t === "inlineStr") value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
        else if (t === "str") value = v !== undefined ? decodeXml(v) : null;
        else if (t === "b") value = v === "1" || v === "true";
        else if (t === "e") value = null;
        else if (t === "d") value = v !== undefined ? decodeXml(v) : null;
        else if (v !== undefined && v.trim() !== "") {
          const n = Number(v);
          value = dateStyles[Number(ca["s"] ?? 0)] ? serialToIso(n, date1904) : n;
        }
        while (row.length < col) row.push(null);
        row[col] = value === "" ? null : value;
      }
      while (matrix.length < rowIdx) matrix.push([]);
      matrix[rowIdx] = row;
    }
    return tableFromMatrix(matrix);
  };

  return { sheetNames: sheets.map((s) => s.name), readSheet };
}
