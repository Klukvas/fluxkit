// Compares two computed-style snapshots (plan `docs/plans/2026-11-08-design-changeability.md`, section 7):
//
//   node --experimental-strip-types apps/storefront/e2e/support/visual/compare-cli.ts <before> <after> \
//     [--exceptions <file>] [--report <dir>]
//   node --experimental-strip-types apps/storefront/e2e/support/visual/compare-cli.ts --check-exceptions <file>
//
// <before> and <after> are a merged snapshot file or a directory of fragments (what `tests/computed-styles.visual.ts`
// writes). Prints the differences (page, theme, selector, property, before, after); with `--report`, also writes
// `computed-styles.txt` and `computed-styles.json` there. `--check-exceptions` only validates an exceptions file.
// Exit code: 0 no undeclared difference (or a valid file), 1 undeclared differences, 2 bad input (unreadable snapshot,
// invalid exceptions file, snapshots of different harness versions, bad arguments).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyExceptions, diffSnapshots, formatComparison } from "./compare.ts";
import { parseExceptions, type VisualException } from "./exceptions.ts";
import { loadSnapshot } from "./snapshot.ts";

const USAGE =
  "Usage: compare-cli.ts <before> <after> [--exceptions <file>] [--report <dir>] | --check-exceptions <file>";

type Arguments =
  | { mode: "check"; exceptions: string }
  | {
      mode: "compare";
      before: string;
      after: string;
      exceptions: string | undefined;
      report: string | undefined;
    };

function parseArguments(argv: readonly string[]): Arguments {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (["--exceptions", "--report", "--check-exceptions"].includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value. ${USAGE}`);
      options.set(argument, value);
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option ${argument}. ${USAGE}`);
    } else {
      positional.push(argument);
    }
  }
  const check = options.get("--check-exceptions");
  if (check !== undefined) {
    if (positional.length > 0 || options.size > 1) throw new Error(USAGE);
    return { mode: "check", exceptions: check };
  }
  const [before, after, ...rest] = positional;
  if (before === undefined || after === undefined || rest.length > 0) throw new Error(USAGE);
  return {
    mode: "compare",
    before,
    after,
    exceptions: options.get("--exceptions"),
    report: options.get("--report"),
  };
}

function readExceptions(path: string): VisualException[] {
  if (!existsSync(path)) throw new Error(`${path} does not exist.`);
  return parseExceptions(JSON.parse(readFileSync(path, "utf8")), path);
}

function main(): number {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.mode === "check") {
      const exceptions = readExceptions(args.exceptions);
      console.log(`${args.exceptions}: ${String(exceptions.length)} valid exception(s).`);
      return 0;
    }
    const exceptions = args.exceptions === undefined ? [] : readExceptions(args.exceptions);
    const comparison = applyExceptions(
      diffSnapshots(loadSnapshot(args.before), loadSnapshot(args.after)),
      exceptions,
    );
    const text = formatComparison(comparison);
    console.log(text);
    if (args.report !== undefined) {
      mkdirSync(args.report, { recursive: true });
      writeFileSync(join(args.report, "computed-styles.txt"), `${text}\n`);
      writeFileSync(
        join(args.report, "computed-styles.json"),
        `${JSON.stringify(comparison, null, 2)}\n`,
      );
    }
    return comparison.undeclared.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`visual compare: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

process.exitCode = main();
