// Runs dependency-cruiser and fails on violations AND when it cruised nothing.
// Guards against a silent false pass (e.g. an unsupported TypeScript version makes the tool see 0 modules).
import { spawnSync } from "node:child_process";

const MIN_MODULES = 1;

const run = spawnSync(
  "pnpm",
  [
    "exec",
    "depcruise",
    "--config",
    ".dependency-cruiser.cjs",
    "--output-type",
    "json",
    "apps",
    "packages",
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error("check:boundaries: could not parse dependency-cruiser output.");
  console.error(run.stdout || run.stderr);
  process.exit(2);
}

const { totalCruised, violations, error, warn } = report.summary;
console.log(
  `modules cruised: ${totalCruised}, violations: ${violations.length} (errors: ${error}, warnings: ${warn})`,
);

if (totalCruised < MIN_MODULES) {
  console.error(
    "check:boundaries: dependency-cruiser cruised no modules. Check the TypeScript version it supports.",
  );
  process.exit(2);
}
if (error > 0) {
  for (const v of violations) {
    console.error(`${v.rule.name}: ${v.from} -> ${v.to}`);
  }
  process.exit(1);
}
