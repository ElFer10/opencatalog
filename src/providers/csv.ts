import type { Value } from "../core/model";
import { ParsedTable, coerceNumber, tableFromMatrix } from "./table";

export interface CsvOptions {
  /** Field delimiter; detected from the first lines when omitted. */
  delimiter?: string;
  /** Convert unambiguous numeric cells to numbers (default true). */
  numbers?: boolean;
}

const CANDIDATES = [",", ";", "\t", "|"];

/** Pick the delimiter that splits the first lines into the most consistent, widest rows. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 64 * 1024);
  let best = ",";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const rows = splitRecords(sample, d).slice(0, 20);
    if (rows.length === 0) continue;
    const widths = rows.map((r) => r.length);
    const first = widths[0]!;
    if (first < 2) continue;
    const consistent = widths.filter((w) => w === first).length / widths.length;
    const score = consistent * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** RFC 4180 tokenizer: quoted fields, doubled quotes, CRLF/LF/CR line ends, newlines inside quotes. */
export function splitRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsv(text: string, opts: CsvOptions = {}): ParsedTable {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const numbers = opts.numbers ?? true;
  const decimalComma = delimiter !== ",";
  const raw = splitRecords(text, delimiter);
  // The first non-blank row is the header and must stay text even if it looks numeric.
  const headerIdx = raw.findIndex((r) => r.some((c) => c.trim() !== ""));
  const matrix: Value[][] = raw.map((r, idx) =>
    idx <= headerIdx || !numbers ? r : r.map((cell) => coerceNumber(cell, decimalComma)),
  );
  return { ...tableFromMatrix(matrix), decimalSeparator: decimalComma ? "," : "." };
}
