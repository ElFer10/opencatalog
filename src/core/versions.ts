/**
 * Versions (languages, markets): fields like "Name_sv" / "Name_es" or "Price (SE)" / "Price (ES)"
 * are variants of a base field. Choosing a version makes every base field show that variant, so the
 * same document can be updated and exported per language.
 */
import { DataSource, FieldDef, isEmpty } from "./model";

export interface VersionInfo {
  /** Version codes in first-seen order, e.g. ["sv", "es"]. */
  versions: string[];
  /** Base field → version → actual field name. */
  variants: Map<string, Map<string, string>>;
}

const PATTERNS = [/^(.+?)\s*[([]([A-Za-z]{2,3}(?:-[A-Za-z]{2})?)[)\]]$/, /^(.+?)[ _.-]([A-Za-z]{2,3}(?:-[A-Za-z]{2})?)$/];

function split(name: string): [string, string] | null {
  for (const re of PATTERNS) {
    const m = re.exec(name.trim());
    if (m && m[1]!.trim()) return [m[1]!.trim(), m[2]!.toLowerCase()];
  }
  return null;
}

/** A code counts as a version when at least two different base fields use it. */
export function detectVersions(fields: readonly FieldDef[]): VersionInfo {
  const byCode = new Map<string, Map<string, string>>();
  const order: string[] = [];
  for (const f of fields) {
    if (f.expression) continue;
    const s = split(f.name);
    if (!s) continue;
    const [base, code] = s;
    if (!byCode.has(code)) {
      byCode.set(code, new Map());
      order.push(code);
    }
    byCode.get(code)!.set(base, f.name);
  }
  const versions = order.filter((c) => byCode.get(c)!.size >= 2);
  const variants = new Map<string, Map<string, string>>();
  for (const code of versions) {
    for (const [base, field] of byCode.get(code)!) {
      if (!variants.has(base)) variants.set(base, new Map());
      variants.get(base)!.set(code, field);
    }
  }
  return { versions, variants };
}

/**
 * Show `version` in the base fields. Base fields that do not exist in the data are added (after
 * their first variant) so they can be placed; they show the chosen version, or the first one.
 * Empty variants fall back to the base value.
 */
export function applyVersion(ds: DataSource, version: string | null): DataSource {
  const info = detectVersions(ds.fields);
  if (info.versions.length === 0) return ds;
  const existing = new Set(ds.fields.map((f) => f.name));
  const fields: FieldDef[] = [];
  const added: string[] = [];
  for (const f of ds.fields) {
    fields.push(f);
    for (const [base, vars] of info.variants) {
      if (!existing.has(base) && !added.includes(base) && [...vars.values()][0] === f.name) {
        fields.push({ name: base, type: f.type });
        added.push(base);
      }
    }
  }
  const pick = (vars: Map<string, string>): string | undefined => (version ? vars.get(version) : undefined) ?? (version ? undefined : [...vars.values()][0]);
  const records = ds.records.map((r) => {
    const values = { ...r.values };
    for (const [base, vars] of info.variants) {
      const isAdded = added.includes(base);
      const source = isAdded ? (version ? vars.get(version) ?? [...vars.values()][0] : [...vars.values()][0]) : pick(vars);
      if (!source) continue;
      const v = r.values[source];
      if (isAdded) values[base] = v ?? null;
      else if (!isEmpty(v)) values[base] = v ?? null;
    }
    return { ...r, values };
  });
  return { ...ds, fields, records };
}

/** The data field that holds `field` for a version (for writing edits back). */
export function versionFieldFor(ds: DataSource, field: string, version: string | null): string {
  const vars = detectVersions(ds.fields).variants.get(field);
  if (!vars) return field;
  if (version && vars.get(version)) return vars.get(version)!;
  return ds.fields.some((f) => f.name === field) ? field : [...vars.values()][0]!;
}
