/**
 * Computed fields and per-field settings applied on top of a loaded data source.
 */
import { ExprError, Node, evaluate, parse } from "./expr";
import { DataSource, FieldDef, FieldFormat, Value, inferType } from "./model";

export interface ComputedDef {
  name: string;
  expression: string;
}

export interface FieldSettings {
  formats?: Record<string, FieldFormat>;
  computed?: ComputedDef[];
}

export interface ComputedError {
  field: string;
  /** Records where evaluation failed. */
  count: number;
  message: string;
}

/** Check an expression against the fields available to it; returns an error message or null. */
export function validateExpression(expression: string, available: readonly string[]): string | null {
  let tree: Node;
  try {
    tree = parse(expression);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  const names = new Set(available);
  const walkFields = (n: Node): string | null => {
    if (n.t === "field") return names.has(n.name) ? null : `Unknown field "${n.name}"`;
    if (n.t === "un") return walkFields(n.a);
    if (n.t === "bin") return walkFields(n.a) ?? walkFields(n.b);
    if (n.t === "call") {
      for (const a of n.args) {
        const r = walkFields(a);
        if (r) return r;
      }
    }
    return null;
  };
  return walkFields(tree);
}

/** Apply formats and computed fields. Computed fields can use fields defined before them. */
export function applyFieldSettings(base: DataSource, settings: FieldSettings): { source: DataSource; errors: ComputedError[] } {
  const errors: ComputedError[] = [];
  const baseNames = new Set(base.fields.map((f) => f.name));
  let fields: FieldDef[] = base.fields.filter((f) => !f.expression);
  let records = base.records.map((r) => ({ ...r, values: { ...r.values } }));

  for (const def of settings.computed ?? []) {
    const name = def.name.trim();
    if (!name || baseNames.has(name) && !base.fields.find((f) => f.name === name)?.expression) {
      errors.push({ field: name || "(unnamed)", count: 0, message: `"${name}" is empty or already a data field` });
      continue;
    }
    let tree: Node;
    try {
      tree = parse(def.expression);
    } catch (e) {
      errors.push({ field: name, count: records.length, message: e instanceof Error ? e.message : String(e) });
      fields = [...fields, { name, type: "text", expression: def.expression }];
      for (const r of records) r.values[name] = null;
      continue;
    }
    let failed = 0;
    let first = "";
    const values: Value[] = [];
    for (const r of records) {
      let v: Value;
      try {
        v = evaluate(tree, (n) => (n in r.values ? r.values[n]! : undefined));
      } catch (e) {
        failed++;
        if (!first) first = `${r.id}: ${e instanceof ExprError || e instanceof Error ? e.message : String(e)}`;
        v = null;
      }
      r.values[name] = v;
      values.push(v);
    }
    if (failed) errors.push({ field: name, count: failed, message: first });
    fields = [...fields, { name, type: inferType(values), expression: def.expression }];
  }

  const formats = settings.formats ?? {};
  fields = fields.map((f) => (formats[f.name] ? { ...f, format: formats[f.name] } : { ...f, format: undefined }));
  records = records.map((r) => r);
  return { source: { ...base, fields, records }, errors };
}
