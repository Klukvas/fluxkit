// Drawing primitives of the coffee demo pictures (`scripts/generate-coffee-images.mjs`): an SVG canvas with gradient and
// filter definitions, colour helpers, a studio backdrop, soft shadows and shaded solids (cylinders, frustums, boxes) seen
// from slightly above. Pure string building, no dependency.

/** Vertical squash of a circle seen from slightly above: an ellipse's ry is its rx times this. */
export const TILT = 0.28;

/** Fonts of the labels; the committed WebP files carry the rendered text, so the machine that runs the seed needs none. */
export const FONT = "Inter, 'DejaVu Sans', 'Liberation Sans', sans-serif";

function channels(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function toHex(values) {
  return `#${values
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Linear mix of two `#rrggbb` colours, `t` = 0 gives `a`. */
export function mix(a, b, t) {
  const from = channels(a);
  const to = channels(b);
  return toHex(from.map((value, index) => value + (to[index] - value) * t));
}

export const darken = (colour, t) => mix(colour, "#000000", t);
export const lighten = (colour, t) => mix(colour, "#ffffff", t);

/** Escapes text for SVG. */
export function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const round = (value) => Math.round(value * 10) / 10;

/** An SVG document under construction: definitions (gradients, filters, clip paths) and the body, in drawing order. */
export class Canvas {
  constructor(width = 1200, height = 1200) {
    this.width = width;
    this.height = height;
    this.defs = [];
    this.body = [];
    this.count = 0;
  }

  id(prefix) {
    this.count += 1;
    return `${prefix}${this.count}`;
  }

  /** Stops are `[offset, colour, opacity?]`; the direction is in the shape's bounding box (default left to right). */
  linear(stops, { x1 = 0, y1 = 0, x2 = 1, y2 = 0, user = false } = {}) {
    const id = this.id("g");
    const units = user ? ' gradientUnits="userSpaceOnUse"' : "";
    this.defs.push(
      `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${units}>${stopMarkup(stops)}</linearGradient>`,
    );
    return `url(#${id})`;
  }

  radial(stops, { cx = 0.5, cy = 0.5, r = 0.5, fx = cx, fy = cy } = {}) {
    const id = this.id("r");
    this.defs.push(
      `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" fx="${fx}" fy="${fy}">${stopMarkup(stops)}</radialGradient>`,
    );
    return `url(#${id})`;
  }

  /** A Gaussian blur filter; returns the `filter` attribute value. */
  blur(deviation) {
    const id = this.id("f");
    this.defs.push(
      `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${deviation}"/></filter>`,
    );
    return `url(#${id})`;
  }

  /** A clip path of the given shapes; returns the `clip-path` attribute value. */
  clip(shapes) {
    const id = this.id("c");
    this.defs.push(`<clipPath id="${id}">${shapes}</clipPath>`);
    return `url(#${id})`;
  }

  add(...parts) {
    this.body.push(...parts);
    return this;
  }

  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><defs>${this.defs.join("")}</defs>${this.body.join("")}</svg>`;
  }
}

function stopMarkup(stops) {
  return stops
    .map(
      ([offset, colour, opacity = 1]) =>
        `<stop offset="${offset}" stop-color="${colour}"${opacity === 1 ? "" : ` stop-opacity="${opacity}"`}/>`,
    )
    .join("");
}

/**
 * A seamless studio backdrop: a light sweep tinted by `tint`, brighter behind the subject, with a soft vignette and a hint of
 * a floor below `floorY`.
 */
export function studio(canvas, tint, { floorY = 0.7 } = {}) {
  const { width, height } = canvas;
  const sweep = canvas.linear(
    [
      [0, mix(tint, "#ffffff", 0.35)],
      [floorY - 0.08, mix(tint, "#ffffff", 0.62)],
      [floorY + 0.06, mix(tint, "#ffffff", 0.5)],
      [1, mix(tint, "#ffffff", 0.3)],
    ],
    { x2: 0, y2: 1 },
  );
  const glow = canvas.radial(
    [
      [0, "#ffffff", 0.55],
      [1, "#ffffff", 0],
    ],
    { cx: 0.5, cy: 0.45, r: 0.55 },
  );
  const vignette = canvas.radial(
    [
      [0.55, darken(tint, 0.3), 0],
      [1, darken(tint, 0.35), 0.28],
    ],
    { cx: 0.5, cy: 0.5, r: 0.75 },
  );
  canvas.add(
    `<rect width="${width}" height="${height}" fill="${sweep}"/>`,
    `<rect width="${width}" height="${height}" fill="${glow}"/>`,
    `<rect width="${width}" height="${height}" fill="${vignette}"/>`,
  );
}

/** A soft shadow on the floor under an object: a wide, faint penumbra and a tight, darker contact shadow. */
export function shadow(canvas, cx, cy, rx, ry, strength = 1) {
  const wide = canvas.blur(Math.max(8, rx * 0.12));
  const tight = canvas.blur(Math.max(3, rx * 0.04));
  canvas.add(
    `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx * 1.08)}" ry="${round(ry * 1.3)}" fill="#1b1410" opacity="${0.16 * strength}" filter="${wide}"/>`,
    `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx * 0.86)}" ry="${round(ry * 0.6)}" fill="#120c08" opacity="${0.32 * strength}" filter="${tight}"/>`,
  );
}

/** Horizontal shading of a round body lit from the upper left: dark rim, broad highlight, soft core, darker right edge. */
export function roundShade(canvas, base, { gloss = 0.32, edge = 0.3, highlightAt = 0.26 } = {}) {
  return canvas.linear([
    [0, darken(base, edge)],
    [0.07, darken(base, edge * 0.35)],
    [highlightAt, lighten(base, gloss)],
    [highlightAt + 0.16, base],
    [0.78, darken(base, edge * 0.45)],
    [0.94, darken(base, edge * 0.85)],
    [1, darken(base, edge * 0.6)],
  ]);
}

/** Shading of a translucent body: mostly clear, with bright edges and a highlight streak. */
export function glassShade(canvas, tint = "#ffffff") {
  return canvas.linear([
    [0, lighten(tint, 0.2), 0.55],
    [0.06, tint, 0.18],
    [0.2, "#ffffff", 0.6],
    [0.27, "#ffffff", 0.12],
    [0.75, tint, 0.08],
    [0.92, "#ffffff", 0.35],
    [1, lighten(tint, 0.2), 0.55],
  ]);
}

/**
 * The visible side of a vertical frustum (a cup, a can, a bottle section): top ellipse at `top` with radius `rTop`, bottom
 * ellipse at `bottom` with `rBottom`. The path runs along the front halves of both ellipses.
 */
export function frustumSide(cx, top, bottom, rTop, rBottom, tilt = TILT) {
  return `M${round(cx - rTop)} ${round(top)} L${round(cx - rBottom)} ${round(bottom)} A${round(rBottom)} ${round(rBottom * tilt)} 0 0 0 ${round(cx + rBottom)} ${round(bottom)} L${round(cx + rTop)} ${round(top)} A${round(rTop)} ${round(rTop * tilt)} 0 0 1 ${round(cx - rTop)} ${round(top)} Z`;
}

export function ellipse(cx, cy, rx, ry, attributes) {
  return `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" ${attributes}/>`;
}

/** The front half of an ellipse as an open path (for rims and seams). */
export function frontArc(cx, cy, rx, ry) {
  return `M${round(cx - rx)} ${round(cy)} A${round(rx)} ${round(ry)} 0 0 0 ${round(cx + rx)} ${round(cy)}`;
}

/** A box seen from the front and a little from the upper right: front face, right side face and top face. */
export function boxFaces(x, y, width, height, depth, { skew = 0.55 } = {}) {
  const dx = depth * 0.62;
  const dy = depth * skew * 0.55;
  return {
    front: `M${round(x)} ${round(y)} H${round(x + width)} V${round(y + height)} H${round(x)} Z`,
    side: `M${round(x + width)} ${round(y)} L${round(x + width + dx)} ${round(y - dy)} V${round(y + height - dy)} L${round(x + width)} ${round(y + height)} Z`,
    top: `M${round(x)} ${round(y)} L${round(x + dx)} ${round(y - dy)} H${round(x + width + dx)} L${round(x + width)} ${round(y)} Z`,
    dx,
    dy,
  };
}

/** Text with sensible defaults; `size` in px, `weight` 400 to 800. */
export function text(
  x,
  y,
  content,
  {
    size = 40,
    weight = 700,
    fill = "#222",
    anchor = "middle",
    spacing = 0,
    opacity = 1,
    family = FONT,
    style = "",
  } = {},
) {
  return `<text x="${round(x)}" y="${round(y)}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${spacing === 0 ? "" : ` letter-spacing="${spacing}"`}${opacity === 1 ? "" : ` opacity="${opacity}"`}${style === "" ? "" : ` font-style="${style}"`}>${esc(content)}</text>`;
}

/** A small deterministic pseudo-random generator (the pictures must be the same on every run). */
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Seed from a string, so each picture has its own but stable scatter of beans, ice and grains. */
export function seedOf(name) {
  let hash = 2166136261;
  for (const char of name) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

export { round };
