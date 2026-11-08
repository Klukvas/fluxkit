#!/usr/bin/env node
// Draws the pictures of the coffee demo dataset into `seeds/assets/coffee/` (plan docs/plans/2026-11-06-coffee-shop-seed.md):
// product pictures (1200 x 1200) and home banners (1280 x 640). Each picture is a parametric SVG illustration
// (`scripts/coffee-images/`: one renderer per product archetype on a studio backdrop) encoded to WebP with the `sharp` that
// `apps/api` already depends on (ADR 0028), so no dependency is added. The media service accepts JPEG, PNG and WebP, never SVG.
//
// The output is committed as seed data, like `scripts/generate-demo-images.mjs`: the labels are text, and text rendering
// depends on the fonts and the librsvg of the machine, so drawing at seed time would give different (or broken) pictures per
// machine. Run this script again only when a drawing changes:
//
//   node scripts/generate-coffee-images.mjs                     # writes seeds/assets/coffee/*.webp
//   node scripts/generate-coffee-images.mjs --only syrup-       # writes only the files whose name starts with "syrup-"
//   node scripts/generate-coffee-images.mjs --check             # exits 1 when a drawn file is missing or over budget
//   node scripts/generate-coffee-images.mjs --sheet <file.png>  # writes a contact sheet of the committed files (no writes in seeds/)
//
// `pnpm install` must have run (sharp is resolved from apps/api).
import { Buffer } from "node:buffer";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DRAWINGS } from "./coffee-images/catalog.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(repoRoot, "seeds/assets/coffee");
/** Size budget of one committed file (plan: each under about 40 KB, all under about 2.5 MB). */
const MAX_FILE_BYTES = 40_000;
const MAX_TOTAL_BYTES = 2_500_000;
const QUALITY = 74;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function rasterize(sharp, drawing) {
  const svg = typeof drawing === "string" ? drawing : drawing.svg;
  return sharp(Buffer.from(svg));
}

function check() {
  const problems = [];
  let total = 0;
  for (const name of Object.keys(DRAWINGS)) {
    const file = resolve(assetsDir, `${name}.webp`);
    if (!existsSync(file)) {
      problems.push(`missing ${name}.webp`);
      continue;
    }
    const size = statSync(file).size;
    total += size;
    if (size > MAX_FILE_BYTES)
      problems.push(`${name}.webp is ${size} bytes (budget ${MAX_FILE_BYTES})`);
  }
  if (total > MAX_TOTAL_BYTES) problems.push(`${total} bytes in total (budget ${MAX_TOTAL_BYTES})`);
  if (problems.length > 0) {
    console.error(`Coffee images in seeds/assets/coffee: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log(`All ${Object.keys(DRAWINGS).length} coffee images exist, ${total} bytes in total.`);
}

/** One PNG with every committed picture in a grid (for a visual review). */
async function sheet(sharp, output) {
  const cell = 240;
  const names = Object.keys(DRAWINGS);
  const columns = 10;
  const tiles = [];
  for (const [index, name] of names.entries()) {
    const bytes = await readFile(resolve(assetsDir, `${name}.webp`));
    tiles.push({
      input: await sharp(bytes)
        .resize(cell, cell, { fit: "contain", background: "#ffffff" })
        .png()
        .toBuffer(),
      left: (index % columns) * cell,
      top: Math.floor(index / columns) * cell,
    });
  }
  await sharp({
    create: {
      width: columns * cell,
      height: Math.ceil(names.length / columns) * cell,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(tiles)
    .png({ compressionLevel: 9, palette: true })
    .toFile(output);
  console.log(`Contact sheet of ${names.length} pictures: ${output}`);
}

async function main() {
  if (process.argv.includes("--check")) {
    check();
    return;
  }
  const sharp = createRequire(resolve(repoRoot, "apps/api/package.json"))("sharp");
  const sheetFile = argument("--sheet");
  if (sheetFile !== undefined) {
    await sheet(sharp, resolve(sheetFile));
    return;
  }
  const prefix = argument("--only") ?? "";
  await mkdir(assetsDir, { recursive: true });
  let total = 0;
  const selected = Object.entries(DRAWINGS).filter(([name]) => name.startsWith(prefix));
  for (const [name, draw] of selected) {
    const bytes = await rasterize(sharp, draw())
      .webp({ quality: QUALITY, effort: 6, smartSubsample: true })
      .toBuffer();
    await writeFile(resolve(assetsDir, `${name}.webp`), bytes);
    total += bytes.length;
    console.log(
      `${name}.webp ${bytes.length} bytes${bytes.length > MAX_FILE_BYTES ? "  OVER BUDGET" : ""}`,
    );
  }
  console.log(`${selected.length} images, ${total} bytes in total, in seeds/assets/coffee/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
