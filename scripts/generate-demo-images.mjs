#!/usr/bin/env node
// Draws the demo product illustrations of `seeds/assets/` (plan docs/plans/2026-11-01-demo-images-local-run.md).
//
// Each image is a flat SVG illustration (no text, no brand, no person) encoded to WebP with the `sharp` that `apps/api`
// already depends on (ADR 0028), so no dependency is added. The output is committed as seed data; run this script again
// only when a drawing changes:
//
//   node scripts/generate-demo-images.mjs            # writes seeds/assets/*.webp
//   node scripts/generate-demo-images.mjs --check    # exits 1 when a file the seed names is missing (no writes)
//
// `pnpm install` must have run (sharp is resolved from apps/api). SVG rendering goes through the local librsvg, so the
// bytes can differ slightly between machines; that is why the files are committed instead of generated on every seed.
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(repoRoot, "seeds/assets");
const SIZE = 800;

// One neutral palette for every drawing: a tinted background per category, a soft floor shadow, darker outlines.
const BACKGROUND = { clothing: "#eee9e3", tools: "#e5e9eb", digital: "#ebe7ef" };
const SHADOW = "#000000";
const FABRIC = {
  black: { fill: "#2f3033", line: "#18191b", detail: "#45474b" },
  white: { fill: "#f8f7f3", line: "#b9b5ad", detail: "#e4e1da" },
  red: { fill: "#b5473d", line: "#7e2c25", detail: "#c9625a" },
  blue: { fill: "#46648f", line: "#2c4366", detail: "#5d7ca6" },
  grey: { fill: "#8f969c", line: "#5d6368", detail: "#a7adb2" },
};
const METAL = { fill: "#a9b0b6", line: "#666d73", light: "#cfd4d8" };
const HANDLE = { fill: "#c27b3c", line: "#8a5124", light: "#d79a62" };
const GRIP = { fill: "#3f4a45", line: "#262d2a", light: "#56625c" };

function frame(category, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BACKGROUND[category]}"/>
  <ellipse cx="400" cy="690" rx="250" ry="34" fill="${SHADOW}" opacity="0.08"/>
  ${body}
</svg>`;
}

function tShirt(colour) {
  const c = FABRIC[colour];
  return frame(
    "clothing",
    `<path d="M300 170 L230 190 L120 270 L170 360 L240 320 L240 650 L560 650 L560 320 L630 360 L680 270 L570 190 L500 170
      C485 215 445 240 400 240 C355 240 315 215 300 170 Z" fill="${c.fill}" stroke="${c.line}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M300 170 C315 215 355 240 400 240 C445 240 485 215 500 170" fill="none" stroke="${c.line}" stroke-width="10" stroke-linecap="round"/>
    <path d="M240 320 L240 300 M560 320 L560 300" stroke="${c.line}" stroke-width="5" stroke-linecap="round"/>
    <path d="M250 620 L550 620" stroke="${c.detail}" stroke-width="5"/>`,
  );
}

function hoodie(colour) {
  const c = FABRIC[colour];
  return frame(
    "clothing",
    `<path d="M310 190 L235 215 C190 240 170 300 160 380 L140 620 L215 630 L245 400 L250 655 L550 655 L555 400 L585 630
      L660 620 L640 380 C630 300 610 240 565 215 L490 190 Z" fill="${c.fill}" stroke="${c.line}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M310 190 C300 120 350 95 400 95 C450 95 500 120 490 190 C470 250 330 250 310 190 Z" fill="${c.detail}" stroke="${c.line}" stroke-width="6"/>
    <path d="M335 195 C345 150 455 150 465 195 C440 225 360 225 335 195 Z" fill="${c.line}" opacity="0.55"/>
    <path d="M370 225 L365 320 M430 225 L435 320" stroke="${c.line}" stroke-width="6" stroke-linecap="round"/>
    <path d="M300 470 L500 470 L530 580 L270 580 Z" fill="${c.detail}" stroke="${c.line}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M140 600 L215 610 M585 610 L660 600 M250 630 L550 630" stroke="${c.line}" stroke-width="5" opacity="0.6"/>`,
  );
}

function linenShirt(colour) {
  const c = FABRIC[colour];
  return frame(
    "clothing",
    `<path d="M320 170 L240 195 C200 215 185 260 178 330 L160 620 L230 628 L252 380 L252 655 L548 655 L548 380 L570 628
      L640 620 L622 330 C615 260 600 215 560 195 L480 170 L400 215 Z" fill="${c.fill}" stroke="${c.line}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M320 170 L355 140 L400 215 L445 140 L480 170 L455 245 L400 215 L345 245 Z" fill="${c.detail}" stroke="${c.line}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M400 215 L400 655" stroke="${c.line}" stroke-width="5"/>
    ${[290, 365, 440, 515, 590].map((y) => `<circle cx="415" cy="${y}" r="7" fill="${c.line}"/>`).join("")}
    <path d="M285 300 L355 300 L355 360 L285 360 Z" fill="none" stroke="${c.line}" stroke-width="4"/>
    <path d="M160 600 L230 608 M570 608 L640 600" stroke="${c.line}" stroke-width="5" opacity="0.6"/>`,
  );
}

function screwdriver() {
  return frame(
    "tools",
    `<g transform="rotate(-35 400 400)">
      <rect x="370" y="80" width="60" height="70" rx="10" fill="${GRIP.light}" stroke="${GRIP.line}" stroke-width="6"/>
      <rect x="355" y="140" width="90" height="230" rx="38" fill="${HANDLE.fill}" stroke="${HANDLE.line}" stroke-width="6"/>
      <path d="M380 165 L380 345 M400 160 L400 350 M420 165 L420 345" stroke="${HANDLE.light}" stroke-width="8" stroke-linecap="round"/>
      <rect x="375" y="365" width="50" height="35" rx="6" fill="${GRIP.fill}" stroke="${GRIP.line}" stroke-width="6"/>
      <rect x="388" y="398" width="24" height="300" fill="${METAL.fill}" stroke="${METAL.line}" stroke-width="6"/>
      <path d="M388 698 L392 735 L408 735 L412 698 Z" fill="${METAL.light}" stroke="${METAL.line}" stroke-width="6" stroke-linejoin="round"/>
      <path d="M396 410 L396 690" stroke="${METAL.light}" stroke-width="5"/>
    </g>`,
  );
}

function hammer() {
  return frame(
    "tools",
    `<g transform="rotate(-20 400 400)">
      <rect x="372" y="230" width="56" height="460" rx="22" fill="${HANDLE.fill}" stroke="${HANDLE.line}" stroke-width="6"/>
      <path d="M392 260 L392 660" stroke="${HANDLE.light}" stroke-width="8" stroke-linecap="round"/>
      <rect x="368" y="560" width="64" height="130" rx="24" fill="${GRIP.fill}" stroke="${GRIP.line}" stroke-width="6"/>
      <path d="M215 150 L520 150 C560 150 600 175 630 215 L600 235 C580 215 560 210 540 215 L540 270 L230 270 C215 270 205 258 205 245
        L205 160 C205 155 210 150 215 150 Z" fill="${METAL.fill}" stroke="${METAL.line}" stroke-width="6" stroke-linejoin="round"/>
      <rect x="185" y="160" width="30" height="100" rx="6" fill="${METAL.light}" stroke="${METAL.line}" stroke-width="6"/>
      <path d="M240 175 L520 175" stroke="${METAL.light}" stroke-width="8" stroke-linecap="round"/>
    </g>`,
  );
}

function wrench() {
  return frame(
    "tools",
    `<g transform="rotate(35 400 400)">
      <rect x="365" y="300" width="70" height="420" rx="30" fill="${METAL.fill}" stroke="${METAL.line}" stroke-width="6"/>
      <rect x="372" y="540" width="56" height="170" rx="24" fill="${GRIP.fill}" stroke="${GRIP.line}" stroke-width="6"/>
      <circle cx="400" cy="680" r="12" fill="${BACKGROUND.tools}" stroke="${GRIP.line}" stroke-width="5"/>
      <path d="M300 300 C280 230 300 150 360 110 L380 200 L420 200 L440 110 C500 150 520 230 500 300 C470 340 330 340 300 300 Z"
        fill="${METAL.fill}" stroke="${METAL.line}" stroke-width="6" stroke-linejoin="round"/>
      <rect x="380" y="200" width="40" height="40" fill="${BACKGROUND.tools}"/>
      <ellipse cx="400" cy="320" rx="26" ry="14" fill="${METAL.light}" stroke="${METAL.line}" stroke-width="5"/>
      <path d="M380 350 L380 520" stroke="${METAL.light}" stroke-width="8" stroke-linecap="round"/>
    </g>`,
  );
}

function eBook() {
  return frame(
    "digital",
    `<rect x="230" y="110" width="340" height="560" rx="36" fill="#34363b" stroke="#1d1e21" stroke-width="6"/>
    <rect x="255" y="150" width="290" height="470" rx="8" fill="#f4efe6"/>
    <rect x="255" y="150" width="290" height="250" fill="#6f8f7a"/>
    <circle cx="455" cy="230" r="46" fill="#e7c56b"/>
    <path d="M255 400 L330 300 L385 360 L430 315 L545 400 Z" fill="#4c6b57"/>
    <rect x="285" y="440" width="230" height="22" rx="11" fill="#3d3f44"/>
    <rect x="285" y="480" width="170" height="14" rx="7" fill="#9a958c"/>
    <rect x="285" y="540" width="120" height="14" rx="7" fill="#c3bdb2"/>
    <circle cx="400" cy="645" r="10" fill="#4a4c52"/>`,
  );
}

function templatePack() {
  const card = (x, y, rotate, accent) => `<g transform="rotate(${rotate} ${x + 150} ${y + 200})">
      <rect x="${x}" y="${y}" width="300" height="400" rx="18" fill="#fbfaf7" stroke="#8d8798" stroke-width="6"/>
      <rect x="${x + 25}" y="${y + 25}" width="250" height="120" rx="8" fill="${accent}"/>
      <rect x="${x + 25}" y="${y + 170}" width="180" height="18" rx="9" fill="#5b5666"/>
      <rect x="${x + 25}" y="${y + 205}" width="250" height="12" rx="6" fill="#cdc8d4"/>
      <rect x="${x + 25}" y="${y + 230}" width="230" height="12" rx="6" fill="#cdc8d4"/>
      <rect x="${x + 25}" y="${y + 280}" width="115" height="90" rx="8" fill="#e3dfe8"/>
      <rect x="${x + 160}" y="${y + 280}" width="115" height="90" rx="8" fill="#e3dfe8"/>
    </g>`;
  return frame(
    "digital",
    `${card(170, 170, -14, "#c9a46a")}
    ${card(260, 150, 6, "#7d9bb5")}
    ${card(330, 230, 18, "#a3708b")}`,
  );
}

/** Every file the demo seed names (`seeds/src/products.ts`), with its drawing. */
const IMAGES = {
  "t-shirt-front": () => tShirt("white"),
  "t-shirt-black": () => tShirt("black"),
  "t-shirt-red": () => tShirt("red"),
  "hoodie-front": () => hoodie("grey"),
  "linen-shirt-white": () => linenShirt("white"),
  "linen-shirt-blue": () => linenShirt("blue"),
  screwdriver,
  hammer,
  wrench,
  "e-book-cover": eBook,
  "template-pack": templatePack,
};

async function main() {
  if (process.argv.includes("--check")) {
    const missing = Object.keys(IMAGES).filter(
      (name) => !existsSync(resolve(assetsDir, `${name}.webp`)),
    );
    if (missing.length > 0) {
      console.error(`Missing demo images in seeds/assets: ${missing.join(", ")}`);
      process.exit(1);
    }
    console.log(`All ${Object.keys(IMAGES).length} demo images exist.`);
    return;
  }
  const sharp = createRequire(resolve(repoRoot, "apps/api/package.json"))("sharp");
  await mkdir(assetsDir, { recursive: true });
  let total = 0;
  for (const [name, draw] of Object.entries(IMAGES)) {
    const bytes = await sharp(Buffer.from(draw())).webp({ quality: 82, effort: 6 }).toBuffer();
    await writeFile(resolve(assetsDir, `${name}.webp`), bytes);
    total += bytes.length;
    console.log(`${name}.webp ${bytes.length} bytes`);
  }
  console.log(`${Object.keys(IMAGES).length} images, ${total} bytes in total, in seeds/assets/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
