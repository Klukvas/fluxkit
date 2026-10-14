// Fails when an installed package has a license outside the policy (scripts/license-policy.json, AGENTS.md section 16).
// Production dependencies must be on the strict list or an explicit exception; dev-only packages may also use devOnlyExtra.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const policy = JSON.parse(readFileSync(new URL("./license-policy.json", import.meta.url), "utf8"));

function list(args) {
  const out = execFileSync("pnpm", ["licenses", "list", "--json", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const byLicense = JSON.parse(out);
  const packages = [];
  for (const [license, entries] of Object.entries(byLicense)) {
    for (const entry of entries) {
      packages.push({ name: entry.name, versions: entry.versions ?? [], license });
    }
  }
  return packages;
}

/** "A OR B" is fine if any side is allowed; "A AND B" needs every side allowed. */
function expressionAllowed(expression, allowed) {
  const clean = expression.replace(/[()]/g, "").trim();
  if (clean.includes(" OR ")) {
    return clean.split(" OR ").some((part) => expressionAllowed(part, allowed));
  }
  if (clean.includes(" AND ")) {
    return clean.split(" AND ").every((part) => expressionAllowed(part, allowed));
  }
  return allowed.has(clean);
}

const isException = (pkg) =>
  policy.exceptions.some((rule) => rule.package === pkg.name && rule.license === pkg.license);

const all = list([]);
const prod = list(["--prod"]);
if (all.length === 0 || prod.length === 0) {
  console.error("check:licenses: pnpm returned no packages; refusing to pass on an empty result.");
  process.exit(2);
}
const prodNames = new Set(prod.map((pkg) => pkg.name));

const strict = new Set(policy.strict);
const devAllowed = new Set([...policy.strict, ...policy.devOnlyExtra]);
const violations = [];
for (const pkg of all) {
  if (isException(pkg)) continue;
  const runtime = prodNames.has(pkg.name);
  const allowed = runtime ? strict : devAllowed;
  if (!expressionAllowed(pkg.license, allowed)) {
    violations.push(
      `${runtime ? "runtime" : "dev"}: ${pkg.name}@${pkg.versions.join(",")} has license "${pkg.license}"`,
    );
  }
}

console.log(
  `packages checked: ${all.length} (runtime ${prod.length}), exceptions defined: ${policy.exceptions.length}`,
);
if (violations.length > 0) {
  console.error(
    "License policy violations:\n" + violations.map((line) => `  - ${line}`).join("\n"),
  );
  process.exit(1);
}
