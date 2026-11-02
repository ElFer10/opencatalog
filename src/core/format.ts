/**
 * Field formatting for the document (and the reverse, for Update Panel).
 */
import { DataSource, FieldDef, FieldFormat, FieldType, Value, formatForDocument, isEmpty, parseFromDocument } from "./model";

type Ds = Pick<DataSource, "decimalSeparator">;

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthName(m: number, locale: string | undefined, short: boolean): string {
  try {
    const d = new Date(Date.UTC(2000, m - 1, 15));
    return new Intl.DateTimeFormat(locale, { month: short ? "short" : "long", timeZone: "UTC" }).format(d).replace(/\.$/, "");
  } catch {
    const n = MONTHS_EN[m - 1] ?? "";
    return short ? n.slice(0, 3) : n;
  }
}

/** Format an ISO date string ("2026-03-01" or "2026-03-01T14:30:00") with a simple pattern. */
export function formatDate(iso: string, pattern: string, locale?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso.trim());
  if (!m) return iso;
  const [, y, mo, d, hh = "00", mi = "00"] = m;
  const month = Number(mo);
  const tokens: Record<string, string> = {
    YYYY: y!, YY: y!.slice(2), MMMM: monthName(month, locale, false), MMM: monthName(month, locale, true),
    MM: mo!, M: String(month), DD: d!, D: String(Number(d)), HH: hh, mm: mi,
  };
  return pattern.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|mm/g, (t) => tokens[t] ?? t);
}

/** Format a number with fixed decimals, decimal separator and thousands grouping. */
export function formatNumber(n: number, decimal: "." | ",", decimals?: number, thousands?: string): string {
  let s = decimals !== undefined ? Math.abs(n).toFixed(Math.max(0, Math.min(10, decimals))) : String(Math.abs(n));
  if (s.includes("e")) return String(n); // very large/small: leave as is
  let [int = "0", frac] = s.split(".");
  if (thousands) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  s = frac !== undefined ? `${int}${decimal}${frac}` : int;
  return n < 0 && Number(n) !== 0 ? `-${s}` : s;
}

function applyCase(s: string, c: FieldFormat["case"]): string {
  if (c === "upper") return s.toLocaleUpperCase();
  if (c === "lower") return s.toLocaleLowerCase();
  if (c === "title") return s.toLocaleLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase());
  return s;
}

export function hasFormat(f: FieldFormat | undefined): f is FieldFormat {
  return !!f && Object.values(f).some((v) => v !== undefined && v !== "");
}

/** Text written into the document for a field value. */
export function formatFieldValue(v: Value | undefined, field: FieldDef | undefined, ds: Ds): string {
  const fmt = field?.format;
  if (!hasFormat(fmt)) return formatForDocument(v, ds);
  if (isEmpty(v)) return fmt.empty ?? "";
  let core: string;
  if (typeof v === "number") core = formatNumber(v, ds.decimalSeparator, fmt.decimals, fmt.thousands);
  else if (field?.type === "date" && typeof v === "string" && fmt.date) core = formatDate(v, fmt.date, fmt.locale);
  else core = formatForDocument(v, ds);
  core = applyCase(core, fmt.case);
  return `${fmt.prefix ?? ""}${core}${fmt.suffix ?? ""}`;
}

/**
 * Reverse of formatFieldValue for text edited in the document. Returns undefined when the text
 * cannot be mapped back to a value (e.g. a date written with a custom pattern).
 */
export function parseFieldText(text: string, field: FieldDef, ds: Ds): Value | undefined {
  const fmt = field.format;
  if (!hasFormat(fmt)) return parseFromDocument(text, field.type, ds);
  if (fmt.empty !== undefined && text === fmt.empty) return null;
  let t = text;
  if (fmt.prefix && t.startsWith(fmt.prefix)) t = t.slice(fmt.prefix.length);
  if (fmt.suffix && t.endsWith(fmt.suffix)) t = t.slice(0, t.length - fmt.suffix.length);
  if (field.type === "number") {
    if (fmt.thousands) t = t.split(fmt.thousands).join("");
    return parseFromDocument(t, "number", ds);
  }
  if (field.type === "date" && fmt.date) return undefined;
  return parseFromDocument(t, field.type as FieldType, ds);
}
