import { DataSource, SourceKind, createDataSource } from "../core/model";
import { parseCsv } from "./csv";
import { parseJson } from "./json";
import { EncodingChoice, TextEncoding, decodeTextDetailed } from "./table";
import { openXlsx } from "./xlsx";

export { parseCsv, detectDelimiter, splitRecords } from "./csv";
export { parseJson } from "./json";
export { openXlsx } from "./xlsx";
export type { ParsedTable, EncodingChoice, TextEncoding } from "./table";
export { ENCODING_LABELS } from "./table";

export const SUPPORTED_EXTENSIONS = ["csv", "tsv", "txt", "xlsx", "json"] as const;

export interface LoadOptions {
  /** Worksheet to read from an .xlsx (defaults to the first). */
  sheet?: string;
  /** CSV delimiter override. */
  delimiter?: string;
  /** Text encoding for CSV/TXT/JSON; detected when "auto" or omitted. */
  encoding?: EncodingChoice;
}

export interface LoadResult {
  source: DataSource;
  /** Worksheet names when the file is a workbook, so the UI can offer a choice. */
  sheets?: string[];
  /** Encoding used to read a text file. */
  encoding?: TextEncoding;
}

export function kindFromFileName(fileName: string): SourceKind {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx") return "xlsx";
  if (ext === "json") return "json";
  if (ext === "csv" || ext === "tsv" || ext === "txt") return "csv";
  throw new Error(`Unsupported file type ".${ext}". Use CSV, TXT, XLSX or JSON.`);
}

/** Turn file bytes into a DataSource. Pure: no file system access. */
export function loadFromBytes(fileName: string, bytes: Uint8Array, opts: LoadOptions = {}): LoadResult {
  const kind = kindFromFileName(fileName);
  const baseName = fileName.replace(/^.*[\\/]/, "");
  if (kind === "xlsx") {
    const wb = openXlsx(bytes);
    const sheet = opts.sheet ?? wb.sheetNames[0];
    const table = wb.readSheet(sheet);
    const name = wb.sheetNames.length > 1 ? `${baseName} [${sheet}]` : baseName;
    return { source: createDataSource(name, kind, table.rows, { columns: table.columns }), sheets: wb.sheetNames };
  }
  const { text, encoding } = decodeTextDetailed(bytes, opts.encoding ?? "auto");
  const delimiter = opts.delimiter ?? (fileName.toLowerCase().endsWith(".tsv") ? "\t" : undefined);
  const table = kind === "json" ? parseJson(text) : parseCsv(text, delimiter ? { delimiter } : {});
  return {
    source: createDataSource(baseName, kind, table.rows, { columns: table.columns, decimalSeparator: table.decimalSeparator }),
    encoding,
  };
}
export { toCsv } from "./csv-writer";
export * from "./remote";
