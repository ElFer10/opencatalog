import type { DataSource } from "../core/model";
import { formatForDocument } from "../core/model";

/** Serialize a data source as CSV (RFC 4180), using ";" when the source uses decimal commas. */
export function toCsv(ds: DataSource, delimiter: string = ds.decimalSeparator === "," ? ";" : ","): string {
  const quote = (s: string) => (/["\r\n]/.test(s) || s.includes(delimiter) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const names = ds.fields.map((f) => f.name);
  const lines = [names.map(quote).join(delimiter)];
  for (const r of ds.records) lines.push(names.map((n) => quote(formatForDocument(r.values[n], ds))).join(delimiter));
  return lines.join("\r\n") + "\r\n";
}
