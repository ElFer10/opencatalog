/**
 * A small, safe expression language for computed fields (no access to anything but the record).
 *
 *   {Price} * 1.25                      field references in braces (or bare names without spaces)
 *   {Name} & " – " & {Unit}             & joins text
 *   if({Stock} > 0, "In stock", "Sold out")
 *   round({Price} * 0.8, 2)   upper({Category})   join(", ", {Color}, {Size})
 *
 * Operators: + - * / %  &  = <> != < <= > >=  and or not  (unary -), parentheses.
 */
import { Value, isEmpty } from "./model";

export type Node =
  | { t: "lit"; v: Value }
  | { t: "field"; name: string }
  | { t: "un"; op: "-" | "not"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "call"; name: string; args: Node[] };

type Tok = { k: "num" | "str" | "field" | "id" | "op" | "eof"; v: string; pos: number };

export class ExprError extends Error {
  constructor(message: string, readonly pos?: number) {
    super(pos === undefined ? message : `${message} (at ${pos + 1})`);
  }
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      while (i < src.length && /[0-9.]/.test(src[i]!)) i++;
      out.push({ k: "num", v: src.slice(start, i), pos: start });
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < src.length) {
          const n = src[i + 1]!;
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          i += 2;
        } else s += src[i++];
      }
      if (i >= src.length) throw new ExprError("Unclosed text", start);
      i++;
      out.push({ k: "str", v: s, pos: start });
      continue;
    }
    if (c === "{") {
      const end = src.indexOf("}", i);
      if (end < 0) throw new ExprError("Unclosed field reference", start);
      out.push({ k: "field", v: src.slice(i + 1, end).trim(), pos: start });
      i = end + 1;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      while (i < src.length && /[\p{L}\p{N}_.]/u.test(src[i]!)) i++;
      out.push({ k: "id", v: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>", "!=", "=="].includes(two)) {
      out.push({ k: "op", v: two, pos: start });
      i += 2;
      continue;
    }
    if ("+-*/%&=<>(),!".includes(c)) {
      out.push({ k: "op", v: c, pos: start });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected character "${c}"`, start);
  }
  out.push({ k: "eof", v: "", pos: src.length });
  return out;
}

const BINARY: Record<string, number> = {
  or: 1, and: 2, "=": 3, "==": 3, "<>": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "&": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6,
};

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const expect = (v: string) => {
    const t = next();
    if (t.v !== v) throw new ExprError(`Expected "${v}"`, t.pos);
  };
  const opOf = (t: Tok): string | null => {
    if (t.k === "op" && t.v in BINARY) return t.v;
    if (t.k === "id" && (t.v.toLowerCase() === "and" || t.v.toLowerCase() === "or")) return t.v.toLowerCase();
    return null;
  };

  const primary = (): Node => {
    const t = next();
    if (t.k === "num") {
      const n = Number(t.v);
      if (!Number.isFinite(n)) throw new ExprError(`Invalid number "${t.v}"`, t.pos);
      return { t: "lit", v: n };
    }
    if (t.k === "str") return { t: "lit", v: t.v };
    if (t.k === "field") return { t: "field", name: t.v };
    if (t.k === "op" && t.v === "(") {
      const e = expr(0);
      expect(")");
      return e;
    }
    if (t.k === "op" && (t.v === "-" || t.v === "!")) return { t: "un", op: t.v === "-" ? "-" : "not", a: unary() };
    if (t.k === "id") {
      const low = t.v.toLowerCase();
      if (low === "true" || low === "false") return { t: "lit", v: low === "true" };
      if (low === "null" || low === "empty") return { t: "lit", v: null };
      if (low === "not") return { t: "un", op: "not", a: unary() };
      if (peek().v === "(") {
        next();
        const args: Node[] = [];
        if (peek().v !== ")") {
          do args.push(expr(0));
          while (peek().v === "," && next());
        }
        expect(")");
        return { t: "call", name: low, args };
      }
      return { t: "field", name: t.v };
    }
    throw new ExprError(t.k === "eof" ? "Unexpected end of expression" : `Unexpected "${t.v}"`, t.pos);
  };
  const unary = (): Node => primary();
  const expr = (minPrec: number): Node => {
    let left = unary();
    for (;;) {
      const op = opOf(peek());
      if (!op || BINARY[op]! < minPrec) break;
      next();
      const right = expr(BINARY[op]! + 1);
      left = { t: "bin", op, a: left, b: right };
    }
    return left;
  };
  const tree = expr(0);
  if (peek().k !== "eof") throw new ExprError(`Unexpected "${peek().v}"`, peek().pos);
  return tree;
}

/** Field names an expression reads (for validation and dependency checks). */
export function referencedFields(node: Node): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.t === "field") out.add(n.name);
    else if (n.t === "un") walk(n.a);
    else if (n.t === "bin") {
      walk(n.a);
      walk(n.b);
    } else if (n.t === "call") n.args.forEach(walk);
  };
  walk(node);
  return [...out];
}

const text = (v: Value): string => (v === null ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v));

function num(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v.trim() === "") return 0;
  const n = Number(v.trim().replace(",", "."));
  if (!Number.isFinite(n)) throw new ExprError(`"${v}" is not a number`);
  return n;
}

const truthy = (v: Value): boolean => (typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : !isEmpty(v));

function compare(a: Value, b: Value): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const na = Number(a);
  const nb = Number(b);
  if (typeof a === "number" && b !== null && b !== "" && Number.isFinite(nb)) return a - nb;
  if (typeof b === "number" && a !== null && a !== "" && Number.isFinite(na)) return na - b;
  return text(a).localeCompare(text(b), undefined, { sensitivity: "base" });
}

const round = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
};

type Fn = (args: Value[]) => Value;
const arity = (name: string, args: Value[], min: number, max = min) => {
  if (args.length < min || args.length > max) throw new ExprError(`${name}() takes ${min === max ? min : `${min}–${max}`} argument${max === 1 ? "" : "s"}`);
};

const FUNCTIONS: Record<string, Fn> = {
  concat: (a) => a.map(text).join(""),
  join: (a) => { arity("join", a, 1, 99); return a.slice(1).filter((v) => !isEmpty(v)).map(text).join(text(a[0]!)); },
  upper: (a) => { arity("upper", a, 1); return text(a[0]!).toLocaleUpperCase(); },
  lower: (a) => { arity("lower", a, 1); return text(a[0]!).toLocaleLowerCase(); },
  trim: (a) => { arity("trim", a, 1); return text(a[0]!).trim(); },
  len: (a) => { arity("len", a, 1); return text(a[0]!).length; },
  left: (a) => { arity("left", a, 2); return text(a[0]!).slice(0, Math.max(0, num(a[1]!))); },
  right: (a) => { arity("right", a, 2); const s = text(a[0]!); const n = Math.max(0, num(a[1]!)); return n === 0 ? "" : s.slice(-n); },
  mid: (a) => { arity("mid", a, 2, 3); const s = text(a[0]!); const st = Math.max(1, num(a[1]!)) - 1; return a[2] === undefined ? s.slice(st) : s.slice(st, st + Math.max(0, num(a[2]))); },
  replace: (a) => { arity("replace", a, 3); return text(a[0]!).split(text(a[1]!)).join(text(a[2]!)); },
  contains: (a) => { arity("contains", a, 2); return text(a[0]!).toLocaleLowerCase().includes(text(a[1]!).toLocaleLowerCase()); },
  startswith: (a) => { arity("startswith", a, 2); return text(a[0]!).toLocaleLowerCase().startsWith(text(a[1]!).toLocaleLowerCase()); },
  number: (a) => { arity("number", a, 1); return isEmpty(a[0]!) ? null : num(a[0]!); },
  text: (a) => { arity("text", a, 1, 2); const v = a[0]!; return a[1] === undefined || typeof v !== "number" ? text(v) : num(v).toFixed(num(a[1])); },
  round: (a) => { arity("round", a, 1, 2); return round(num(a[0]!), a[1] === undefined ? 0 : num(a[1])); },
  floor: (a) => { arity("floor", a, 1); return Math.floor(num(a[0]!)); },
  ceil: (a) => { arity("ceil", a, 1); return Math.ceil(num(a[0]!)); },
  abs: (a) => { arity("abs", a, 1); return Math.abs(num(a[0]!)); },
  min: (a) => { arity("min", a, 1, 99); return Math.min(...a.filter((v) => !isEmpty(v)).map(num)); },
  max: (a) => { arity("max", a, 1, 99); return Math.max(...a.filter((v) => !isEmpty(v)).map(num)); },
  isempty: (a) => { arity("isempty", a, 1); return isEmpty(a[0]!); },
  coalesce: (a) => a.find((v) => !isEmpty(v)) ?? null,
};

export const FUNCTION_NAMES = ["if", ...Object.keys(FUNCTIONS)].sort();

export type FieldLookup = (name: string) => Value | undefined;

export function evaluate(node: Node, field: FieldLookup): Value {
  switch (node.t) {
    case "lit":
      return node.v;
    case "field": {
      const v = field(node.name);
      if (v === undefined) throw new ExprError(`Unknown field "${node.name}"`);
      return v;
    }
    case "un": {
      const v = evaluate(node.a, field);
      return node.op === "-" ? -num(v) : !truthy(v);
    }
    case "bin": {
      if (node.op === "and") return truthy(evaluate(node.a, field)) && truthy(evaluate(node.b, field));
      if (node.op === "or") return truthy(evaluate(node.a, field)) || truthy(evaluate(node.b, field));
      const a = evaluate(node.a, field);
      const b = evaluate(node.b, field);
      switch (node.op) {
        case "&": return text(a) + text(b);
        case "+": return num(a) + num(b);
        case "-": return num(a) - num(b);
        case "*": return num(a) * num(b);
        case "/": { const d = num(b); if (d === 0) throw new ExprError("Division by zero"); return num(a) / d; }
        case "%": { const d = num(b); if (d === 0) throw new ExprError("Division by zero"); return num(a) % d; }
        case "=": case "==": return compare(a, b) === 0;
        case "<>": case "!=": return compare(a, b) !== 0;
        case "<": return compare(a, b) < 0;
        case "<=": return compare(a, b) <= 0;
        case ">": return compare(a, b) > 0;
        case ">=": return compare(a, b) >= 0;
      }
      throw new ExprError(`Unknown operator ${node.op}`);
    }
    case "call": {
      if (node.name === "if") {
        if (node.args.length < 2 || node.args.length > 3) throw new ExprError("if() takes 2 or 3 arguments");
        return truthy(evaluate(node.args[0]!, field)) ? evaluate(node.args[1]!, field) : node.args[2] ? evaluate(node.args[2], field) : null;
      }
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new ExprError(`Unknown function "${node.name}()"`);
      const v = fn(node.args.map((a) => evaluate(a, field)));
      return typeof v === "number" && !Number.isFinite(v) ? null : v;
    }
  }
}
