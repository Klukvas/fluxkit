// One-time helper for a client fork moving to the split storefront messages (docs/migrations/2026-11-08-storefront-messages-split.md).
// Compares the fork's OLD flat messages file with upstream's OLD flat file (the version the fork started from) and writes the
// keys whose text the fork changed as an overrides file (`apps/storefront/src/messages-overrides/<locale>.json`).
// Keys the fork added or removed cannot be overrides: they are reported on stderr and left out.
//
// Usage: node scripts/messages-extract-overrides.mjs --fork <fork-uk.json> --upstream <upstream-uk.json>
//          [--messages apps/storefront/src/messages/uk] [--out apps/storefront/src/messages-overrides/uk.json]
// --messages: the CURRENT upstream area files of the same locale; an override whose key is no longer there (upstream renamed or
// removed it) is reported and left out, because the storefront refuses an override without a base message.
// No dependency; plain Node 22.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const usage =
  "Usage: node scripts/messages-extract-overrides.mjs --fork <fork-uk.json> --upstream <upstream-uk.json> [--messages <dir>] [--out <file>]";

/** The value after `name`; a missing value or another flag in its place is a usage error, never taken as a path. */
function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`${name} needs a value.\n${usage}`);
    process.exit(2);
  }
  return value;
}

function readObject(file) {
  let content;
  try {
    content = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} could not be read as JSON: ${error.message}`, { cause: error });
  }
  if (typeof content !== "object" || content === null || Array.isArray(content)) {
    throw new Error(`${file} must hold a JSON object of flat keys.`);
  }
  return content;
}

function report(title, keys) {
  if (keys.length > 0) console.error(`${title} (${keys.length}):\n  ${keys.join("\n  ")}`);
}

const forkFile = option("--fork");
const upstreamFile = option("--upstream");
const messagesDir = option("--messages");
const outFile = option("--out");
if (forkFile === undefined || upstreamFile === undefined) {
  console.error(usage);
  process.exit(2);
}

try {
  const fork = readObject(forkFile);
  const upstream = readObject(upstreamFile);
  let current;
  if (messagesDir !== undefined) {
    if (!existsSync(messagesDir)) throw new Error(`${messagesDir} was not found.`);
    current = new Set();
    for (const name of readdirSync(messagesDir).filter((entry) => entry.endsWith(".json"))) {
      for (const key of Object.keys(readObject(join(messagesDir, name)))) current.add(key);
    }
  }
  const overrides = {};
  const gone = [];
  for (const [key, text] of Object.entries(fork)) {
    if (!Object.hasOwn(upstream, key) || upstream[key] === text) continue;
    if (current !== undefined && !current.has(key)) {
      gone.push(key);
      continue;
    }
    overrides[key] = text;
  }
  report(
    "Keys the fork added that are not in upstream (an override cannot add a key; add them as custom.<name> keys to apps/storefront/src/messages-extra/<locale>.json and use the new names in the fork's code)",
    Object.keys(fork).filter((key) => !Object.hasOwn(upstream, key)),
  );
  report(
    "Keys the fork removed (an override cannot remove a key; upstream's text stays)",
    Object.keys(upstream).filter((key) => !Object.hasOwn(fork, key)),
  );
  report(
    "Changed keys that the current upstream messages no longer have (renamed or removed upstream; port them by hand)",
    gone,
  );
  const json = `${JSON.stringify(overrides, null, 2)}\n`;
  if (outFile === undefined) process.stdout.write(json);
  else {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, json);
  }
  console.error(
    `${Object.keys(overrides).length} override(s) written${outFile ? ` to ${outFile}` : ""}.`,
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
