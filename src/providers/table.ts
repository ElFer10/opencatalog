import type { RawRow, Value } from "../core/model";

/** A parsed rectangular table, before it becomes a DataSource. */
export interface ParsedTable {
  columns: string[];
  rows: RawRow[];
  /** Decimal separator found in the source text, when it could be determined. */
  decimalSeparator?: "." | ",";
}

/** Turn header cells into unique, non-empty column names. */
export function normalizeHeaders(cells: readonly (Value | undefined)[]): string[] {
  const used = new Map<string, number>();
  return cells.map((c, i) => {
    let base = c === null || c === undefined ? "" : String(c).trim();
    if (base === "") base = `Column ${i + 1}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/** Build a table from a header row plus data rows, dropping fully empty rows. */
export function tableFromMatrix(matrix: readonly (readonly (Value | undefined)[])[]): ParsedTable {
  const isBlank = (row: readonly (Value | undefined)[]) =>
    row.every((v) => v === null || v === undefined || (typeof v === "string" && v.trim() === ""));
  const nonEmpty = matrix.filter((r) => !isBlank(r));
  const header = nonEmpty[0];
  if (!header) return { columns: [], rows: [] };
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const padded = Array.from({ length: width }, (_, i) => header[i]);
  const columns = normalizeHeaders(padded);
  const rows = nonEmpty.slice(1).map((r) => {
    const row: RawRow = {};
    columns.forEach((c, i) => {
      const v = r[i];
      row[c] = v === undefined ? null : v;
    });
    return row;
  });
  return { columns, rows };
}

/**
 * Convert a text cell to a number only when it is unambiguous.
 * Codes with leading zeros (EAN, article numbers) stay text.
 */
export function coerceNumber(text: string, decimalComma: boolean): Value {
  const t = text.trim();
  if (t === "") return null;
  const re = decimalComma ? /^-?\d+(,\d+)?$/ : /^-?\d+(\.\d+)?$/;
  if (!re.test(t)) return text;
  if (/^-?0\d/.test(t)) return text;
  const n = Number(decimalComma ? t.replace(",", ".") : t);
  if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) return text;
  return n;
}

export type TextEncoding = "utf-8" | "utf-16" | "windows-1252" | "mac-roman";
export type EncodingChoice = "auto" | TextEncoding;

export const ENCODING_LABELS: Record<EncodingChoice, string> = {
  auto: "Auto",
  "utf-8": "UTF-8",
  "utf-16": "UTF-16",
  "windows-1252": "Windows (1252)",
  "mac-roman": "Mac Roman",
};

/** Characters for bytes 0x80–0xFF in Mac OS Roman. */
const MAC_ROMAN = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›\ufb01\ufb02‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uf8ffÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

/**
 * Guess between Windows-1252 and Mac Roman for text that is not valid UTF-8.
 * Accented letters (å ä ö é ñ ü…) sit in 0x80–0x9F in Mac Roman but in 0xC0–0xFF in Windows-1252,
 * where 0x80–0x9F holds rare punctuation instead.
 */
export function guessLegacyEncoding(b: Uint8Array): "windows-1252" | "mac-roman" {
  let low = 0;
  let high = 0;
  for (const c of b) {
    if (c >= 0x80 && c <= 0x9f) low++;
    else if (c >= 0xc0) high++;
  }
  return low > high ? "mac-roman" : "windows-1252";
}

/** Decode bytes, detecting the encoding unless one is forced. */
export function decodeTextDetailed(bytes: Uint8Array, choice: EncodingChoice = "auto"): { text: string; encoding: TextEncoding } {
  let start = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: decodeUtf16(bytes.subarray(2), true), encoding: "utf-16" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: decodeUtf16(bytes.subarray(2), false), encoding: "utf-16" };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const body = bytes.subarray(start);
  if (choice === "utf-16") return { text: decodeUtf16(body, true), encoding: "utf-16" };
  if (choice === "windows-1252") return { text: decodeWin1252(body), encoding: "windows-1252" };
  if (choice === "mac-roman") return { text: decodeMacRoman(body), encoding: "mac-roman" };
  const utf8 = decodeUtf8(body);
  if (choice === "utf-8") return { text: utf8 ?? decodeUtf8Lossy(body), encoding: "utf-8" };
  if (utf8 !== null) return { text: utf8, encoding: "utf-8" };
  const legacy = guessLegacyEncoding(body);
  return { text: legacy === "mac-roman" ? decodeMacRoman(body) : decodeWin1252(body), encoding: legacy };
}

/** Decode bytes as text (UTF-8, UTF-16 with BOM, Windows-1252 or Mac Roman, detected). */
export function decodeText(bytes: Uint8Array, choice: EncodingChoice = "auto"): string {
  return decodeTextDetailed(bytes, choice).text;
}

function decodeMacRoman(b: Uint8Array): string {
  let s = "";
  for (const c of b) s += c < 0x80 ? String.fromCharCode(c) : MAC_ROMAN[c - 0x80]!;
  return s;
}

function decodeUtf8Lossy(b: Uint8Array): string {
  let s = "";
  for (const c of b) s += c < 0x80 ? String.fromCharCode(c) : "\ufffd";
  return s;
}

function decodeUtf16(b: Uint8Array, le: boolean): string {
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(le ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!);
  return s;
}

/** Strict UTF-8 decoder; returns null on invalid input. */
export function decodeUtf8(b: Uint8Array): string | null {
  const out: string[] = [];
  let chunk: number[] = [];
  const flush = () => {
    out.push(String.fromCodePoint(...chunk));
    chunk = [];
  };
  for (let i = 0; i < b.length; ) {
    const c = b[i]!;
    let cp: number;
    let extra: number;
    if (c < 0x80) {
      cp = c;
      extra = 0;
    } else if (c >= 0xc2 && c < 0xe0) {
      cp = c & 0x1f;
      extra = 1;
    } else if (c >= 0xe0 && c < 0xf0) {
      cp = c & 0x0f;
      extra = 2;
    } else if (c >= 0xf0 && c < 0xf5) {
      cp = c & 0x07;
      extra = 3;
    } else return null;
    for (let k = 1; k <= extra; k++) {
      const n = b[i + k];
      if (n === undefined || (n & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (n & 0x3f);
    }
    if ((extra === 2 && cp < 0x800) || (extra === 3 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    chunk.push(cp);
    if (chunk.length >= 8192) flush();
    i += extra + 1;
  }
  flush();
  return out.join("");
}

const WIN1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function decodeWin1252(b: Uint8Array): string {
  let s = "";
  for (const c of b) s += String.fromCharCode(WIN1252[c] ?? c);
  return s;
}
