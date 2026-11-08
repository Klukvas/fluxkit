// Compares two computed-style snapshots (plan `docs/plans/2026-11-08-design-changeability.md`, section 7):
//
//   node --experimental-strip-types apps/storefront/e2e/support/visual/compare-cli.ts <before> <after> \
//     [--exceptions <file>] [--report <dir>]
//
// <before> and <after> are a merged snapshot file or a directory of fragments (what `tests/computed-styles.visual.ts`
// writes). Prints the differences (page, theme, selector, property, before, after); with `--report`, also writes
// `computed-styles.txt` and `computed-styles.json` there. Exit code: 0 no undeclared difference, 1 undeclared differences,
// 2 bad input (unreadable snapshot, invalid exceptions file, snapshots of different harness versions).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyExceptions, diffSnapshots, formatComparison } from "./compare.ts";
import { parseExceptions, type VisualException } from "./exceptions.ts";
import { loadSnapshot } from "./snapshot.ts";

interface Arguments {
  before: string;
  after: string;
  exceptions: string | undefined;
  report: string | undefined;
}

function parseArguments(argv: readonly string[]): Arguments {
  const positional: string[] = [];
  let exceptions: string | undefined;
  let report: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === "--exceptions" || argument === "--report") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value.`);
      if (argument === "--exceptions") exceptions = value;
      else report = value;
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option ${argument}.`);
    } else {
      positional.push(argument);
    }
  }
  const [before, after, ...rest] = positional;
  if (before === undefined || after === undefined || rest.length > 0) {
    throw new Error(
      "Usage: compare-cli.ts <before> <after> [--exceptions <file>] [--report <dir>]",
    );
  }
  return { before, after, exceptions, report };
}

function main(): number {
  let comparison;
  let exceptions: VisualException[] = [];
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.exceptions !== undefined) {
      if (!existsSync(args.exceptions)) throw new Error(`${args.exceptions} does not exist.`);
      exceptions = parseExceptions(
        JSON.parse(readFileSync(args.exceptions, "utf8")),
        args.exceptions,
      );
    }
    comparison = applyExceptions(
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
  } catch (error) {
    console.error(`visual compare: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  return comparison.undeclared.length === 0 ? 0 : 1;
}

process.exitCode = main();
