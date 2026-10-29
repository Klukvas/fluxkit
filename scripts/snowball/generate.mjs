// Translates a Snowball algorithm file (https://snowballstem.org, BSD-3-Clause) into a TypeScript module of closures that
// run on packages/core/src/search/stemmers/snowball-runtime.ts. It supports the subset of the language that the Ukrainian
// and English algorithms use and fails loudly on anything else.
//
// Usage (from the repository root, then format the output with Prettier):
//   node scripts/snowball/generate.mjs <algorithm.sbl> <out.ts> <exportName> "<upstream version>"
// The committed inputs and outputs are listed in packages/core/src/search/stemmers/README.md.
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath, exportName, upstream] = process.argv;
if (!inPath || !outPath || !exportName || !upstream) {
  console.error(
    'usage: node scripts/snowball/generate.mjs <algorithm.sbl> <out.ts> <exportName> "<upstream version>"',
  );
  process.exit(2);
}

// Comments first (they contain apostrophes), then the string definitions.
let source = readFileSync(inPath, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
const stringdefs = new Map();
source = source.replace(/^stringdef\s+(\S+)\s+'\{U\+([0-9A-Fa-f]+)\}'.*$/gm, (_, name, hex) => {
  stringdefs.set(name, String.fromCodePoint(Number.parseInt(hex, 16)));
  return "";
});
source = source.replace(/^stringescapes.*$/m, "");

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < text.length && text[j] !== "'") {
        if (text[j] === "{") {
          const close = text.indexOf("}", j);
          const name = text.slice(j + 1, close);
          if (stringdefs.has(name)) value += stringdefs.get(name);
          else if (name === "'")
            value += "'"; // stringescapes {} makes {'} an apostrophe
          else throw new Error(`unknown stringdef {${name}}`);
          j = close + 1;
        } else {
          value += text[j++];
        }
      }
      tokens.push({ type: "str", value });
      i = j + 1;
    } else if ("()[]$+".includes(ch)) {
      tokens.push({ type: ch });
      i++;
    } else if (["<-", "<=", ">=", "==", "!="].includes(text.slice(i, i + 2))) {
      tokens.push({ type: "op", value: text.slice(i, i + 2) });
      i += 2;
    } else if ("<>=".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
    } else if (/[0-9]/.test(ch)) {
      let j = i;
      while (/[0-9]/.test(text[j])) j++;
      tokens.push({ type: "num", value: Number(text.slice(i, j)) });
      i = j;
    } else if (/[A-Za-z_]/.test(ch) || text.startsWith("non-", i)) {
      let j = text.startsWith("non-", i) ? i + 4 : i;
      while (/[A-Za-z0-9_]/.test(text[j])) j++;
      tokens.push({ type: "name", value: text.slice(i, j) });
      i = j;
    } else {
      throw new Error(
        `unexpected character ${JSON.stringify(ch)} near ${JSON.stringify(text.slice(i, i + 30))}`,
      );
    }
  }
  return tokens;
}

const tokens = tokenize(source);
let pos = 0;
const peek = () => tokens[pos];
const take = () => tokens[pos++];
const peekName = (value) => peek()?.type === "name" && peek().value === value;
function expect(type) {
  const token = take();
  if (token?.type !== type)
    throw new Error(`expected ${type}, got ${JSON.stringify(token)} at token ${pos}`);
  return token;
}

const routines = new Set();
const booleans = new Set();
const integers = new Set();
const groupings = new Map();
const amongs = [];
const definitions = [];
let pendingSubstrings = [];

function nameList() {
  expect("(");
  const names = [];
  while (peek().type !== ")") names.push(expect("name").value);
  expect(")");
  return names;
}

function arithmetic() {
  const token = take();
  if (token.type === "num") return { type: "int", value: token.value };
  if (token.type === "name") {
    if (token.value === "limit") return { type: "limit" };
    if (token.value === "cursor") return { type: "cursor" };
    if (integers.has(token.value)) return { type: "var", value: token.value };
  }
  throw new Error(`bad arithmetic expression ${JSON.stringify(token)}`);
}

function single() {
  const token = take();
  if (!token) throw new Error("unexpected end of input");
  switch (token.type) {
    case "(":
      return list();
    case "[":
      return { type: "bra" };
    case "]":
      return { type: "ket" };
    case "str":
      return { type: "lit", value: token.value };
    case "$": {
      if (peek().type === "(") {
        take();
        const a = arithmetic();
        const op = expect("op").value;
        const b = arithmetic();
        expect(")");
        return { type: "cmp", a, op, b };
      }
      const name = expect("name").value;
      const op = expect("op").value;
      const value = arithmetic();
      return op === "="
        ? { type: "assign", name, value }
        : { type: "cmp", a: { type: "var", value: name }, op, b: value };
    }
    case "op":
      if (token.value === "<-") return { type: "replace", value: expect("str").value };
      break;
    case "name":
      return named(token.value);
  }
  throw new Error(`unexpected token ${JSON.stringify(token)} at ${pos}`);
}

function named(name) {
  switch (name) {
    case "not":
    case "try":
    case "do":
    case "test":
    case "backwards":
    case "repeat":
    case "goto":
    case "fail":
      return { type: name, command: single() };
    case "setlimit": {
      if (!peekName("tomark")) throw new Error("only setlimit tomark is supported");
      take();
      const mark = arithmetic();
      if (!peekName("for")) throw new Error("expected for");
      take();
      return { type: "setlimit", mark, command: single() };
    }
    case "substring": {
      const node = { type: "substring", table: -1 };
      pendingSubstrings.push(node);
      return node;
    }
    case "among":
      return among();
    case "delete":
    case "atlimit":
    case "false":
    case "true":
    case "next":
      return { type: name };
    case "set":
    case "unset":
      return { type: "set", name: expect("name").value, value: name === "set" };
    case "hop":
      return { type: "hop", count: expect("num").value };
    case "gopast":
      return { type: "gopast", grouping: expect("name").value };
    case "setmark":
      return { type: "setmark", name: expect("name").value };
    case "atmark":
      return { type: "atmark", name: expect("name").value };
    default:
      if (routines.has(name)) return { type: "call", name };
      if (booleans.has(name)) return { type: "flag", name };
      if (groupings.has(name) || (name.startsWith("non-") && groupings.has(name.slice(4))))
        return { type: "group", grouping: name };
      throw new Error(`unknown name ${name} at token ${pos}`);
  }
}

// `A or B C` is `(A or B) C`: `or` joins single commands (compiler/analyser.c, read_C_list).
function list() {
  const items = [];
  while (peek().type !== ")") {
    let item = single();
    if (peekName("and")) throw new Error("`and` is not used by the supported algorithms");
    if (peekName("or")) {
      const alternatives = [item];
      while (peekName("or")) {
        take();
        alternatives.push(single());
      }
      item = { type: "or", alternatives };
    }
    items.push(item);
  }
  expect(")");
  return { type: "seq", items };
}

function among() {
  const substrings = pendingSubstrings;
  pendingSubstrings = [];
  expect("(");
  const groups = [];
  let strings = [];
  while (peek().type !== ")") {
    const token = take();
    if (token.type === "str") {
      strings.push(token.value);
    } else if (token.type === "(") {
      groups.push({ strings, command: list() });
      strings = [];
    } else {
      throw new Error(`unexpected token in among: ${JSON.stringify(token)}`);
    }
  }
  expect(")");
  if (strings.length > 0) groups.push({ strings, command: null });
  const id = amongs.length;
  amongs.push({ id, groups });
  for (const node of substrings) node.table = id;
  return { type: "among", table: id, paired: substrings.length > 0 };
}

while (pos < tokens.length) {
  const token = take();
  if (token.type === ")") continue; // the end of `backwardmode ( ... )`
  if (token.type !== "name") throw new Error(`unexpected top-level token ${JSON.stringify(token)}`);
  switch (token.value) {
    case "routines":
    case "externals":
      nameList().forEach((name) => routines.add(name));
      break;
    case "integers":
      nameList().forEach((name) => integers.add(name));
      break;
    case "booleans":
      nameList().forEach((name) => booleans.add(name));
      break;
    case "groupings":
      nameList().forEach((name) => groupings.set(name, null));
      break;
    case "backwardmode":
      expect("(");
      break;
    case "define": {
      const name = expect("name").value;
      if (peek().type === "str" || (peek().type === "name" && peek().value !== "as")) {
        const characters = [];
        for (;;) {
          const term = take();
          if (term.type === "str") characters.push(...term.value);
          else if (term.type === "name" && groupings.get(term.value))
            characters.push(...groupings.get(term.value));
          else throw new Error(`bad grouping term ${JSON.stringify(term)}`);
          if (peek()?.type !== "+") break;
          take();
        }
        groupings.set(name, characters);
        break;
      }
      take(); // as
      pendingSubstrings = [];
      const body = single();
      if (pendingSubstrings.length > 0) throw new Error(`substring without among in ${name}`);
      definitions.push({ name, body });
      break;
    }
    default:
      throw new Error(`unknown declaration ${token.value}`);
  }
}

const used = new Set(["runStem"]);
const use = (name) => {
  used.add(name);
  return name;
};
const quote = (text) => JSON.stringify(text);
const arithmeticCode = (e) =>
  e.type === "int"
    ? String(e.value)
    : e.type === "limit"
      ? "m.l"
      : e.type === "cursor"
        ? "m.c"
        : `${use("int")}(${quote(e.value)})`;

function emit(node) {
  switch (node.type) {
    case "seq":
      return node.items.length === 1
        ? emit(node.items[0])
        : `${use("seq")}(${node.items.map(emit).join(", ")})`;
    case "or":
      return `${use("or")}(${node.alternatives.map(emit).join(", ")})`;
    case "not":
      return `${use("not")}(${emit(node.command)})`;
    case "try":
      return `${use("attempt")}(${emit(node.command)})`;
    case "do":
      return `${use("doDo")}(${emit(node.command)})`;
    case "test":
      return `${use("test")}(${emit(node.command)})`;
    case "backwards":
      return `${use("backwards")}(${emit(node.command)})`;
    case "repeat":
      return `${use("repeat")}(${emit(node.command)})`;
    case "goto":
      return `${use("goTo")}(${emit(node.command)})`;
    case "fail":
      return `${use("seq")}(${emit(node.command)}, ${use("never")})`;
    case "setlimit":
      return `${use("setLimitToMark")}(() => ${arithmeticCode(node.mark)}, ${emit(node.command)})`;
    case "bra":
      return use("bra");
    case "ket":
      return use("ket");
    case "substring":
      return `${use("substring")}(A${node.table})`;
    case "among":
      return node.paired
        ? `${use("amongCommand")}(A${node.table})`
        : `${use("among")}(A${node.table})`;
    case "delete":
      return use("sliceDelete");
    case "replace":
      return `${use("sliceFrom")}(${quote(node.value)})`;
    case "set":
      return `${use("setFlag")}(${quote(node.name)}, ${node.value})`;
    case "flag":
      return `${use("flag")}(${quote(node.name)})`;
    case "atlimit":
      return use("atLimit");
    case "false":
      return use("never");
    case "true":
      return use("always");
    case "next":
      return use("next");
    case "hop":
      return `${use("hop")}(${node.count})`;
    case "lit":
      return `${use("lit")}(${quote(node.value)})`;
    case "call":
      return `() => r_${node.name}()`;
    case "group":
      return node.grouping.startsWith("non-")
        ? `${use("outGrouping")}(G_${node.grouping.slice(4)})`
        : `${use("inGrouping")}(G_${node.grouping})`;
    case "gopast":
      return node.grouping.startsWith("non-")
        ? `${use("goPastOut")}(G_${node.grouping.slice(4)})`
        : `${use("goPastIn")}(G_${node.grouping})`;
    case "setmark":
      return `${use("setInt")}(${quote(node.name)}, () => m.c)`;
    case "atmark":
      return `${use("cmpInt")}(() => m.c, "==", () => ${use("int")}(${quote(node.name)}))`;
    case "assign":
      return `${use("setInt")}(${quote(node.name)}, () => ${arithmeticCode(node.value)})`;
    case "cmp":
      return `${use("cmpInt")}(() => ${arithmeticCode(node.a)}, ${quote(node.op)}, () => ${arithmeticCode(node.b)})`;
    default:
      throw new Error(`cannot emit ${node.type}`);
  }
}

const body = [];
for (const [name, characters] of groupings) {
  if (characters) body.push(`const G_${name} = new Set(${quote(characters.join(""))});`);
}
for (const table of amongs) {
  body.push(`const A${table.id} = ${use("makeAmong")}([`);
  for (const group of table.groups) {
    body.push(`  [${quote(group.strings)}, ${group.command ? emit(group.command) : "null"}],`);
  }
  body.push("]);");
}
for (const definition of definitions) {
  body.push(`const r_${definition.name}: Cmd = ${emit(definition.body)};`);
}
const usesState = body.some((line) => /\bm\.[a-z]/.test(line));
const imports = ["type Cmd", ...(usesState ? ["m"] : []), ...[...used].sort()];
const header = [
  `// GENERATED by scripts/snowball/generate.mjs from ${inPath.split("/").pop()} of ${upstream}.`,
  "// Snowball is BSD-3-Clause: see snowball/COPYING. Do not edit by hand; change the generator or update the .sbl file.",
];
writeFileSync(
  outPath,
  [
    ...header,
    `import { ${imports.join(", ")} } from "../snowball-runtime.js";`,
    "",
    ...body,
    "",
    `/** Stems one lower-case word with the ${exportName} algorithm. */`,
    `export function ${exportName}(word: string): string {`,
    "  return runStem(word, r_stem);",
    "}",
    "",
  ].join("\n"),
);
console.log(
  `${outPath}: ${definitions.length} routines, ${amongs.length} among tables, ${amongs.reduce((n, t) => n + t.groups.reduce((k, g) => k + g.strings.length, 0), 0)} entries`,
);
