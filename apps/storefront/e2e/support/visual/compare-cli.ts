// Compares two computed-style snapshots (plan `docs/plans/2026-11-08-design-changeability.md`, section 7):
//
//   node --experimental-strip-types apps/storefront/e2e/support/visual/compare-cli.ts <before> <after> \
//     [--exceptions <file>] [--report <dir>] [--strict]
//   ... compare-cli.ts --check-exceptions <file>
//   ... compare-cli.ts --own-exceptions <file> [--inherited <merge-base file>] --write <out>
//
// <before> and <after> are a merged snapshot file or a directory of fragments (what `tests/computed-styles.visual.ts`
// writes). Prints the differences (page, theme, selector, property, before, after) and warns about selectors absent
// everywhere; with `--report`, also writes `computed-styles.txt` and `computed-styles.json` there. `--strict` (CI) also
// fails on exceptions that matched nothing. `--check-exceptions` only validates a file; `--own-exceptions` writes the
// entries a PR added (those not in the merge-base's file, `ownExceptions`).
// Exit code: 0 no undeclared difference (or a valid file), 1 undeclared differences (or, with --strict, unused
// exceptions), 2 bad input (unreadable snapshot, invalid exceptions file, different harness versions, bad arguments).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  alwaysAbsentSelectors,
  applyExceptions,
  diffSnapshots,
  formatComparison,
} from "./compare.ts";
import { ownExceptions, parseExceptions, type VisualException } from "./exceptions.ts";
import { loadSnapshot } from "./snapshot.ts";

const USAGE =
  "Usage: compare-cli.ts <before> <after> [--exceptions <file>] [--report <dir>] [--strict] | --check-exceptions <file> | --own-exceptions <file> [--inherited <file>] --write <out>";

const VALUE_OPTIONS = [
  "--exceptions",
  "--report",
  "--check-exceptions",
  "--own-exceptions",
  "--inherited",
  "--write",
];

type Arguments =
  | { mode: "check"; exceptions: string }
  | { mode: "own"; current: string; inherited: string | undefined; write: string }
  | {
      mode: "compare";
      before: string;
      after: string;
      exceptions: string | undefined;
      report: string | undefined;
      strict: boolean;
    };

function parseArguments(argv: readonly string[]): Arguments {
  const positional: string[] = [];
  const options = new Map<string, string>();
  let strict = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (VALUE_OPTIONS.includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value. ${USAGE}`);
      options.set(argument, value);
      index += 1;
    } else if (argument === "--strict") {
      strict = true;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option ${argument}. ${USAGE}`);
    } else {
      positional.push(argument);
    }
  }
  const check = options.get("--check-exceptions");
  if (check !== undefined) {
    if (positional.length > 0 || options.size > 1 || strict) throw new Error(USAGE);
    return { mode: "check", exceptions: check };
  }
  const own = options.get("--own-exceptions");
  if (own !== undefined) {
    const write = options.get("--write");
    const allowed = new Set(["--own-exceptions", "--inherited", "--write"]);
    if (
      write === undefined ||
      positional.length > 0 ||
      strict ||
      [...options.keys()].some((key) => !allowed.has(key))
    ) {
      throw new Error(USAGE);
    }
    return { mode: "own", current: own, inherited: options.get("--inherited"), write };
  }
  const [before, after, ...rest] = positional;
  if (
    before === undefined ||
    after === undefined ||
    rest.length > 0 ||
    options.has("--inherited") ||
    options.has("--write")
  ) {
    throw new Error(USAGE);
  }
  return {
    mode: "compare",
    before,
    after,
    exceptions: options.get("--exceptions"),
    report: options.get("--report"),
    strict,
  };
}

function readExceptions(path: string): VisualException[] {
  if (!existsSync(path)) throw new Error(`${path} does not exist.`);
  return parseExceptions(JSON.parse(readFileSync(path, "utf8")), path);
}

function readInheritedKeys(path: string): VisualException[] {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(value)) throw new Error(`${path}: must be a JSON array of exceptions.`);
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const { page, theme, selector, property } = record;
    if (typeof page !== "string" || typeof selector !== "string" || typeof property !== "string") {
      return [];
    }
    return [
      {
        page,
        selector,
        property,
        reason: "inherited",
        ...(typeof theme === "string" ? { theme } : {}),
      },
    ];
  });
}

function main(): number {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.mode === "check") {
      const exceptions = readExceptions(args.exceptions);
      console.log(`${args.exceptions}: ${String(exceptions.length)} valid exception(s).`);
      return 0;
    }
    if (args.mode === "own") {
      const current = readExceptions(args.current);
      // The merge-base's entries are only keys to subtract: not validated against this harness (an old entry may name a
      // selector this tree removed; it declares nothing either way).
      const inherited = args.inherited === undefined ? [] : readInheritedKeys(args.inherited);
      const own = ownExceptions(current, inherited);
      writeFileSync(args.write, `${JSON.stringify(own, null, 2)}\n`);
      console.log(
        `${args.current}: ${String(own.length)} exception(s) added by this tree, ${String(current.length - own.length)} inherited from the merge-base and ignored.`,
      );
      return 0;
    }
    const exceptions = args.exceptions === undefined ? [] : readExceptions(args.exceptions);
    const before = loadSnapshot(args.before);
    const after = loadSnapshot(args.after);
    const comparison = applyExceptions(diffSnapshots(before, after), exceptions);
    let text = formatComparison(comparison, alwaysAbsentSelectors(before, after));
    const unusedFails = args.strict && comparison.unused.length > 0;
    if (unusedFails) {
      text += `\n\n--strict: ${String(comparison.unused.length)} declared exception(s) matched nothing; remove them or fix them.`;
    }
    console.log(text);
    if (args.report !== undefined) {
      mkdirSync(args.report, { recursive: true });
      writeFileSync(join(args.report, "computed-styles.txt"), `${text}\n`);
      writeFileSync(
        join(args.report, "computed-styles.json"),
        `${JSON.stringify(comparison, null, 2)}\n`,
      );
    }
    return comparison.undeclared.length === 0 && !unusedFails ? 0 : 1;
  } catch (error) {
    console.error(`visual compare: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

process.exitCode = main();
