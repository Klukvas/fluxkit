// Equipment of the coffee demo pictures: espresso machines, grinders, kettle, scale, tamper, pitcher, portafilter, knock box,
// thermometer, ice maker and blender. Stainless steel, black and white bodies with soft studio reflections.
import {
  TILT,
  darken,
  ellipse,
  frontArc,
  frustumSide,
  glassShade,
  lighten,
  roundShade,
  shadow,
  text,
} from "./lib.mjs";
import { bean, beanPile } from "./goods.mjs";
import { paperCup } from "./cups.mjs";

const STEEL = "#c4c9ce";
const CHROME = "#d9dde1";

/** Brushed steel across a flat panel: soft vertical bands. */
function steelPanel(canvas, base = STEEL) {
  return canvas.linear([
    [0, darken(base, 0.25)],
    [0.08, lighten(base, 0.2)],
    [0.3, base],
    [0.5, lighten(base, 0.35)],
    [0.7, darken(base, 0.05)],
    [0.92, lighten(base, 0.12)],
    [1, darken(base, 0.3)],
  ]);
}

function roundedRect(x, y, w, h, r) {
  return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

/** A group head with a portafilter hanging under it at (`cx`, `y`). */
function groupHead(canvas, cx, y, scale = 1) {
  const s = scale;
  canvas.add(
    `<path d="${frustumSide(cx, y, y + 50 * s, 70 * s, 62 * s)}" fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.45 })}"/>`,
    `<path d="${frustumSide(cx, y + 50 * s, y + 92 * s, 66 * s, 60 * s)}" fill="${roundShade(canvas, "#2a2a2c", { gloss: 0.35, edge: 0.4 })}"/>`,
    // Portafilter handle towards the viewer's right and down.
    `<path d="M${cx + 40 * s} ${y + 66 * s} L${cx + 190 * s} ${y + 100 * s} Q${cx + 205 * s} ${y + 104 * s} ${cx + 202 * s} ${y + 118 * s} L${cx + 196 * s} ${y + 124 * s} Q${cx + 180 * s} ${y + 128 * s} ${cx + 30 * s} ${y + 90 * s} Z" fill="${canvas.linear(
      [
        [0, "#4a4a4e"],
        [0.4, "#1c1c1e"],
        [1, "#0e0e0f"],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
    `<path d="M${cx - 16 * s} ${y + 92 * s} L${cx - 22 * s} ${y + 120 * s} H${cx + 22 * s} L${cx + 16 * s} ${y + 92 * s} Z" fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.4 })}"/>`,
  );
}

/** A commercial semi-automatic espresso machine with one or two groups. */
export function espressoMachine(canvas, groups, body = "#2b2c2f") {
  const width = groups === 1 ? 640 : 900;
  const x = 600 - width / 2;
  const top = 360;
  const height = 520;
  const floor = top + height + 80;
  shadow(canvas, 600, floor, width * 0.58, 46);
  // Feet and the base with the drip tray.
  canvas.add(
    `<rect x="${x + 30}" y="${floor - 30}" width="40" height="30" rx="6" fill="#1a1a1b"/><rect x="${x + width - 70}" y="${floor - 30}" width="40" height="30" rx="6" fill="#1a1a1b"/>`,
    `<path d="${roundedRect(x, top + height - 10, width, 60, 10)}" fill="${steelPanel(canvas)}"/>`,
  );
  // Body: dark side panels, steel front panel and a cup tray on top.
  canvas.add(
    `<path d="${roundedRect(x, top, width, height, 18)}" fill="${roundShade(canvas, body, { gloss: 0.18, edge: 0.4 })}"/>`,
    `<path d="${roundedRect(x + 40, top + 40, width - 80, 150, 10)}" fill="${steelPanel(canvas)}"/>`,
    `<path d="M${x - 10} ${top - 26} H${x + width + 10} L${x + width - 10} ${top + 6} H${x + 10} Z" fill="${canvas.linear(
      [
        [0, lighten(STEEL, 0.25)],
        [1, darken(STEEL, 0.2)],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
  );
  // Cups warming on the top tray.
  for (let index = 0; index < (groups === 1 ? 3 : 5); index += 1) {
    const cx = x + 90 + index * ((width - 180) / Math.max(1, (groups === 1 ? 3 : 5) - 1));
    canvas.add(
      `<path d="${frustumSide(cx, top - 110, top - 30, 42, 32)}" fill="${roundShade(canvas, "#f4f2ee", { gloss: 0.3, edge: 0.3 })}"/>`,
      ellipse(cx, top - 110, 42, 12, `fill="#e8e3da"`),
    );
  }
  // Pressure gauges and buttons on the front panel.
  const gaugeY = top + 115;
  for (const gx of groups === 1
    ? [x + width / 2 - 80, x + width / 2 + 80]
    : [x + width / 2 - 90, x + width / 2 + 90]) {
    canvas.add(
      `<circle cx="${gx}" cy="${gaugeY}" r="46" fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.5 })}"/>`,
      `<circle cx="${gx}" cy="${gaugeY}" r="36" fill="#f7f5f0"/>`,
      `<path d="M${gx - 24} ${gaugeY + 14} A28 28 0 0 1 ${gx + 24} ${gaugeY + 14}" fill="none" stroke="#c0392b" stroke-width="5"/>`,
      `<path d="M${gx} ${gaugeY} L${gx + 18} ${gaugeY - 18}" stroke="#222" stroke-width="4" stroke-linecap="round"/>`,
    );
  }
  const groupXs = groups === 1 ? [600] : [x + width * 0.3, x + width * 0.7];
  for (const gx of groupXs) {
    const buttonsY = top + 230;
    for (let index = 0; index < 4; index += 1) {
      canvas.add(
        `<rect x="${gx - 92 + index * 48}" y="${buttonsY}" width="40" height="28" rx="6" fill="${index === 3 ? "#d8d8d8" : "#3a3b3e"}" stroke="#55565a" stroke-width="2"/>`,
      );
    }
    groupHead(canvas, gx, top + 285, 1.25);
    // A cup under the spouts on the drip tray.
    paperCup(canvas, gx, top + height + 40, "110 мл", 1.8, { paper: "white" });
  }
  // Steam wand(s) on the sides.
  const wands = groups === 1 ? [x + width - 60] : [x + 70, x + width - 70];
  for (const wx of wands) {
    canvas.add(
      `<circle cx="${wx}" cy="${top + 230}" r="18" fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.4 })}"/>`,
      `<path d="M${wx} ${top + 240} C${wx + 4} ${top + 330} ${wx + 30} ${top + 380} ${wx + 26} ${top + 440}" fill="none" stroke="${CHROME}" stroke-width="16" stroke-linecap="round"/>`,
      `<path d="M${wx - 3} ${top + 245} C${wx} ${top + 330} ${wx + 24} ${top + 380} ${wx + 21} ${top + 436}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.8"/>`,
    );
  }
  // Drip tray grille.
  const grille = [];
  for (let gx = x + 30; gx < x + width - 30; gx += 18) {
    grille.push(`M${gx} ${top + height + 4} V${top + height + 36}`);
  }
  canvas.add(
    `<path d="${grille.join(" ")}" stroke="${darken(STEEL, 0.35)}" stroke-width="5" opacity="0.6"/>`,
  );
  canvas.add(
    text(600, top + 32, "CREMA WORKS", { size: 22, weight: 800, fill: "#d8d8d8", spacing: 8 }),
  );
}

/** A close-up of a group head and portafilter with an espresso shot. */
export function groupCloseUp(canvas) {
  // The underside of the machine body, out of focus, with its steel front edge.
  canvas.add(
    `<path d="M-20 -20 H1220 V300 Q1220 330 1190 330 H10 Q-20 330 -20 300 Z" fill="${canvas.linear(
      [
        [0, "#1d1e21"],
        [0.7, "#2e3034"],
        [1, "#3a3c40"],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
    `<rect x="-20" y="300" width="1240" height="34" rx="10" fill="${steelPanel(canvas)}"/>`,
    `<rect x="-20" y="0" width="1240" height="330" fill="${canvas.radial(
      [
        [0, "#ffffff", 0.12],
        [1, "#ffffff", 0],
      ],
      { cx: 0.3, cy: 0.6, r: 0.5 },
    )}"/>`,
  );
  groupHead(canvas, 560, 250, 2.6);
  paperCup(canvas, 560, 1060, "110 мл", 5.2, { paper: "white" });
  canvas.add(
    `<path d="M548 562 C546 700 552 760 548 840" stroke="#5a2e14" stroke-width="10" stroke-linecap="round" opacity="0.9"/>`,
    `<path d="M572 562 C574 700 568 760 572 840" stroke="#6b3a1b" stroke-width="10" stroke-linecap="round" opacity="0.9"/>`,
  );
}

/** A bean-to-cup automatic machine. */
export function automaticMachine(canvas) {
  const x = 390;
  const top = 250;
  const width = 420;
  const height = 720;
  const floor = top + height;
  shadow(canvas, 600, floor, 280, 40);
  canvas.add(
    `<path d="${roundedRect(x, top, width, height, 34)}" fill="${roundShade(canvas, "#2a2b2e", { gloss: 0.2, edge: 0.4 })}"/>`,
    `<path d="${roundedRect(x + 30, top + 40, width - 60, 180, 16)}" fill="${canvas.linear(
      [
        [0, "#0e0f12"],
        [1, "#1f2328"],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
    text(600, top + 110, "Капучино", { size: 36, weight: 700, fill: "#f2e6d6" }),
    text(600, top + 160, "●  ●  ○", { size: 26, weight: 700, fill: "#c99a62" }),
    `<path d="${roundedRect(x + 120, top + 260, width - 240, 220, 12)}" fill="${canvas.linear(
      [
        [0, "#17181a"],
        [1, "#2a2b2e"],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
    `<rect x="${x + 170}" y="${top + 260}" width="${width - 340}" height="50" rx="10" fill="${steelPanel(canvas)}"/>`,
    `<rect x="${x + 40}" y="${floor - 120}" width="${width - 80}" height="70" rx="12" fill="${steelPanel(canvas)}"/>`,
    // Bean hopper lid on the top.
    `<path d="M${x + 60} ${top + 6} Q${x + 150} ${top - 40} ${x + 240} ${top + 6} Z" fill="${roundShade(canvas, "#3a3b3f", { gloss: 0.25, edge: 0.3 })}"/>`,
    text(600, floor - 20, "CREMA WORKS", { size: 22, weight: 800, fill: "#cfcfcf", spacing: 6 }),
  );
  paperCup(canvas, 600, floor - 120, "250 мл", 1.7, { paper: "white" });
}

export function capsuleMachine(canvas) {
  const x = 420;
  const top = 360;
  const width = 360;
  const height = 560;
  const floor = top + height;
  shadow(canvas, 600, floor, 260, 36);
  canvas.add(
    `<path d="${roundedRect(x, top, width, height, 60)}" fill="${roundShade(canvas, "#8e2f2a", { gloss: 0.3, edge: 0.4 })}"/>`,
    `<path d="${roundedRect(x + 60, top + 120, width - 120, 260, 30)}" fill="${canvas.linear(
      [
        [0, "#191a1c"],
        [1, "#2c2d30"],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
    `<path d="${roundedRect(x + 50, top - 50, width - 100, 90, 30)}" fill="${roundShade(canvas, "#2b2b2d", { gloss: 0.3, edge: 0.4 })}"/>`,
    `<path d="M${x + width - 60} ${top - 20} C${x + width + 60} ${top - 40} ${x + width + 70} ${top + 40} ${x + width - 20} ${top + 30}" fill="none" stroke="${CHROME}" stroke-width="18" stroke-linecap="round"/>`,
    `<rect x="${x + 150}" y="${top + 130}" width="60" height="26" rx="8" fill="${steelPanel(canvas)}"/>`,
    `<rect x="${x + 30}" y="${floor - 70}" width="${width - 60}" height="50" rx="12" fill="${steelPanel(canvas)}"/>`,
    `<circle cx="${x + 130}" cy="${top + 60}" r="12" fill="#e8e8e8"/><circle cx="${x + 230}" cy="${top + 60}" r="12" fill="#e8e8e8"/>`,
  );
  paperCup(canvas, 600, floor - 70, "110 мл", 2.2, { paper: "white" });
}

/** An on-demand grinder (`kind` flat or conical) with a bean hopper. */
export function grinder(canvas, kind) {
  const cx = 600;
  const floor = 1010;
  const bodyTop = 520;
  const w = kind === "flat" ? 230 : 190;
  shadow(canvas, cx, floor, w * 1.2, 40);
  canvas.add(
    `<path d="${roundedRect(cx - w, floor - 120, w * 2, 120, 20)}" fill="${roundShade(canvas, "#1f2023", { gloss: 0.2, edge: 0.4 })}"/>`,
    `<path d="M${cx - w * 0.8} ${bodyTop} H${cx + w * 0.8} L${cx + w * 0.7} ${floor - 120} H${cx - w * 0.7} Z" fill="${roundShade(canvas, kind === "flat" ? "#2c2d30" : "#e9e6e0", { gloss: 0.28, edge: 0.4 })}"/>`,
    `<path d="${frustumSide(cx, bodyTop - 50, bodyTop, w * 0.62, w * 0.8)}" fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.45 })}"/>`,
    // Spout and the portafilter fork.
    `<rect x="${cx - 26}" y="${bodyTop + 170}" width="52" height="60" rx="8" fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.4 })}"/>`,
    `<path d="M${cx - 80} ${bodyTop + 300} H${cx + 80}" stroke="${CHROME}" stroke-width="14" stroke-linecap="round"/>`,
    `<circle cx="${cx}" cy="${bodyTop + 100}" r="34" fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.45 })}"/>`,
    text(cx, floor - 50, "CREMA WORKS", { size: 22, weight: 800, fill: "#cfcfcf", spacing: 5 }),
  );
  // Clear hopper with beans.
  const hopperTop = 170;
  const hopper = `M${cx - w * 0.95} ${hopperTop} L${cx - w * 0.5} ${bodyTop - 50} H${cx + w * 0.5} L${cx + w * 0.95} ${hopperTop} Z`;
  const clip = canvas.clip(`<path d="${hopper}"/>`);
  const beans = [];
  for (let row = 0; row < 9; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      const bx = cx - w * 0.95 + column * w * 0.24 + (row % 2) * w * 0.1;
      const by = hopperTop + 120 + row * 26;
      beans.push(bean(canvas, bx, by, 40, (row * 37 + column * 53) % 180));
    }
  }
  canvas.add(
    `<g clip-path="${clip}"><rect x="${cx - w}" y="${hopperTop + 100}" width="${w * 2}" height="300" fill="#2d1a0f"/>${beans.join("")}</g>`,
    `<path d="${hopper}" fill="${glassShade(canvas, "#e7eef1")}" stroke="#ffffff" stroke-width="3" opacity="0.95"/>`,
    ellipse(
      cx,
      hopperTop,
      w * 0.95,
      w * 0.95 * TILT,
      `fill="${roundShade(canvas, "#2b2b2d", { gloss: 0.3, edge: 0.4 })}"`,
    ),
  );
}

export function bladeGrinder(canvas) {
  const cx = 600;
  const floor = 980;
  const r = 150;
  const top = floor - 380;
  shadow(canvas, cx, floor, r * 1.2, r * TILT);
  canvas.add(
    `<path d="${frustumSide(cx, top + 130, floor, r, r * 0.96)}" fill="${roundShade(canvas, "#ecebe7", { gloss: 0.3, edge: 0.35 })}"/>`,
    `<path d="${frustumSide(cx, top + 120, top + 140, r * 1.01, r * 1.01)}" fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.45 })}"/>`,
    `<path d="M${cx - r * 0.9} ${top + 120} Q${cx - r * 0.95} ${top - 10} ${cx} ${top - 20} Q${cx + r * 0.95} ${top - 10} ${cx + r * 0.9} ${top + 120} Z" fill="${glassShade(canvas, "#dfe7ea")}" stroke="#ffffff" stroke-width="3"/>`,
    `<rect x="${cx - 26}" y="${top + 230}" width="52" height="28" rx="8" fill="#2b2b2d"/>`,
    text(cx, floor - 50, "CREMA WORKS", { size: 20, weight: 800, fill: "#8a8a8a", spacing: 4 }),
  );
  beanPile(canvas, cx + 290, floor + 20, 200, 14, "blade", "#4a2a17");
}

export function kettle(canvas) {
  const cx = 560;
  const floor = 980;
  const r = 170;
  const top = floor - 330;
  shadow(canvas, cx, floor, r * 1.4, r * TILT);
  canvas.add(
    `<path d="${frustumSide(cx, floor - 40, floor, r * 1.12, r * 1.12)}" fill="${roundShade(canvas, "#1e1f22", { gloss: 0.2, edge: 0.4 })}"/>`,
    `<rect x="${cx - 40}" y="${floor - 32}" width="80" height="20" rx="6" fill="#59c27a" opacity="0.85"/>`,
    `<path d="M${cx + r * 0.85} ${floor - 120} C${cx + r * 1.6} ${floor - 140} ${cx + r * 1.4} ${top - 40} ${cx + r * 2.1} ${top - 120}" fill="none" stroke="#202124" stroke-width="30" stroke-linecap="round"/>`,
    `<path d="M${cx + r * 0.85} ${floor - 124} C${cx + r * 1.56} ${floor - 146} ${cx + r * 1.36} ${top - 46} ${cx + r * 2.06} ${top - 126}" fill="none" stroke="#5a5c61" stroke-width="6" stroke-linecap="round"/>`,
    `<path d="${frustumSide(cx, top, floor - 40, r * 0.9, r)}" fill="${roundShade(canvas, "#26272a", { gloss: 0.3, edge: 0.45 })}"/>`,
    ellipse(
      cx,
      top,
      r * 0.9,
      r * 0.9 * TILT,
      `fill="${canvas.linear(
        [
          [0, "#3c3d41"],
          [1, "#1c1d1f"],
        ],
        { x2: 0, y2: 1 },
      )}"`,
    ),
    `<path d="M${cx - r * 0.6} ${top - 4} Q${cx} ${top - 70} ${cx + r * 0.6} ${top - 4}" fill="${roundShade(canvas, "#2f3034", { gloss: 0.3, edge: 0.4 })}"/>`,
    `<circle cx="${cx}" cy="${top - 56}" r="16" fill="#c8a27a"/>`,
    `<path d="M${cx - r * 0.88} ${top + 40} C${cx - r * 1.5} ${top + 30} ${cx - r * 1.5} ${floor - 90} ${cx - r * 0.95} ${floor - 90}" fill="none" stroke="#c8a27a" stroke-width="34" stroke-linecap="round"/>`,
  );
}

export function scale(canvas) {
  const x = 330;
  const y = 700;
  const w = 540;
  const d = 320;
  shadow(canvas, 640, 900, 330, 50);
  canvas.add(
    `<path d="M${x} ${y + 60} L${x + 120} ${y - d * 0.4 + 60} H${x + w + 120} L${x + w} ${y + 60} V${y + 120} H${x} Z" fill="#141416"/>`,
    `<path d="M${x} ${y + 60} L${x + 120} ${y - d * 0.4 + 60} H${x + w + 120} L${x + w} ${y + 60} Z" fill="${canvas.linear(
      [
        [0, "#3a3b3e"],
        [1, "#1c1c1e"],
      ],
      { x2: 1, y2: 1 },
    )}"/>`,
    `<path d="M${x} ${y + 60} H${x + w} V${y + 120} H${x} Z" fill="${canvas.linear(
      [
        [0, "#2a2b2e"],
        [1, "#111113"],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
    `<path d="M${x + w} ${y + 60} L${x + w + 120} ${y - d * 0.4 + 60} V${y - d * 0.4 + 120} L${x + w} ${y + 120} Z" fill="#0d0d0e"/>`,
    `<rect x="${x + 40}" y="${y + 70}" width="200" height="40" rx="6" fill="#0a0f0c"/>`,
    text(x + 140, y + 101, "18.0 g", {
      size: 30,
      weight: 700,
      fill: "#8ef0a8",
      family: "'DejaVu Sans Mono', monospace",
    }),
    `<rect x="${x + 300}" y="${y + 70}" width="160" height="40" rx="6" fill="#0a0f0c"/>`,
    text(x + 380, y + 101, "0:28", {
      size: 30,
      weight: 700,
      fill: "#8ef0a8",
      family: "'DejaVu Sans Mono', monospace",
    }),
  );
  paperCup(canvas, x + w / 2 + 70, y + 30, "250 мл", 3, { paper: "white" });
}

export function tamper(canvas) {
  const cx = 600;
  const floor = 990;
  const r = 180;
  shadow(canvas, cx, floor, r * 1.2, r * TILT);
  canvas.add(
    `<path d="${frustumSide(cx, floor - 120, floor, r, r)}" fill="${roundShade(canvas, CHROME, { gloss: 0.6, edge: 0.5 })}"/>`,
    ellipse(
      cx,
      floor - 120,
      r,
      r * TILT,
      `fill="${canvas.linear(
        [
          [0, "#f3f5f7"],
          [1, "#aab1b7"],
        ],
        { x2: 1, y2: 1 },
      )}"`,
    ),
    `<path d="${frustumSide(cx, floor - 200, floor - 120, r * 0.32, r * 0.5)}" fill="${roundShade(canvas, CHROME, { gloss: 0.6, edge: 0.5 })}"/>`,
    `<path d="M${cx - r * 0.32} ${floor - 200} C${cx - r * 0.2} ${floor - 330} ${cx - r * 0.55} ${floor - 470} ${cx - r * 0.42} ${floor - 600} Q${cx} ${floor - 700} ${cx + r * 0.42} ${floor - 600} C${cx + r * 0.55} ${floor - 470} ${cx + r * 0.2} ${floor - 330} ${cx + r * 0.32} ${floor - 200} Z" fill="${roundShade(canvas, "#7a4a2c", { gloss: 0.3, edge: 0.45 })}"/>`,
    text(cx, floor - 50, "58 мм", { size: 34, weight: 700, fill: "#5d646a" }),
  );
}

export function pitcher(canvas, cx, floor, s) {
  const r = 120 * s;
  const h = 300 * s;
  const top = floor - h;
  shadow(canvas, cx, floor, r * 1.2, r * TILT);
  canvas.add(
    `<path d="M${cx + r * 0.9} ${top + 40 * s} C${cx + r * 1.7} ${top + 40 * s} ${cx + r * 1.7} ${floor - 90 * s} ${cx + r * 0.95} ${floor - 70 * s}" fill="none" stroke="${CHROME}" stroke-width="${26 * s}" stroke-linecap="round"/>`,
    `<path d="${frustumSide(cx, top, floor, r * 0.86, r)}" fill="${roundShade(canvas, CHROME, { gloss: 0.6, edge: 0.5 })}"/>`,
    ellipse(
      cx,
      top,
      r * 0.86,
      r * 0.86 * TILT,
      `fill="${canvas.linear(
        [
          [0, "#8f979e"],
          [1, "#e6e9ec"],
        ],
        { x2: 0, y2: 1 },
      )}"`,
    ),
    `<path d="M${cx - r * 0.86} ${top} Q${cx - r * 1.2} ${top - 30 * s} ${cx - r * 1.25} ${top - 34 * s} Q${cx - r * 1.0} ${top + 10 * s} ${cx - r * 0.7} ${top + 14 * s} Z" fill="${CHROME}"/>`,
    `<path d="${frontArc(cx, top, r * 0.86, r * 0.86 * TILT)}" fill="none" stroke="#ffffff" stroke-width="${4 * s}"/>`,
  );
}

export function portafilter(canvas) {
  const cx = 480;
  const cy = 720;
  shadow(canvas, 620, 880, 420, 50, 0.8);
  canvas.add(
    `<path d="M${cx + 120} ${cy + 20} L${cx + 600} ${cy + 140} Q${cx + 640} ${cy + 150} ${cx + 630} ${cy + 190} Q${cx + 620} ${cy + 214} ${cx + 580} ${cy + 204} L${cx + 110} ${cy + 90} Z" fill="${canvas.linear(
      [
        [0, "#6c4128"],
        [0.4, "#8f5a38"],
        [1, "#4a2b1a"],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
    `<path d="${frustumSide(cx, cy, cy + 90, 200, 170)}" fill="${roundShade(canvas, CHROME, { gloss: 0.6, edge: 0.5 })}"/>`,
    ellipse(
      cx,
      cy,
      200,
      200 * TILT,
      `fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.4 })}"`,
    ),
    ellipse(
      cx,
      cy + 4,
      170,
      170 * TILT,
      `fill="${canvas.radial([
        [0, "#7a4b2b"],
        [1, "#4b2a17"],
      ])}"`,
    ),
    ellipse(cx, cy + 4, 170, 170 * TILT, `fill="none" stroke="#9aa1a7" stroke-width="6"`),
  );
}

export function knockBox(canvas) {
  const cx = 600;
  const floor = 990;
  const rx = 260;
  const top = floor - 330;
  shadow(canvas, cx, floor, rx * 1.1, 60);
  canvas.add(
    `<path d="${frustumSide(cx, top, floor, rx, rx * 0.95, 0.42)}" fill="${roundShade(canvas, "#2a2a2c", { gloss: 0.3, edge: 0.45 })}"/>`,
    ellipse(cx, top, rx, rx * 0.42, `fill="#141415"`),
    ellipse(cx, top + 30, rx * 0.86, rx * 0.34, `fill="#3d2414"`),
    `<path d="M${cx - rx * 0.97} ${top - 6} H${cx + rx * 0.97}" stroke="#4a4a4e" stroke-width="40" stroke-linecap="round"/>`,
    `<path d="M${cx - rx * 0.95} ${top - 14} H${cx + rx * 0.95}" stroke="#6a6a70" stroke-width="10" stroke-linecap="round"/>`,
    ellipse(cx, top, rx, rx * 0.42, `fill="none" stroke="#555559" stroke-width="6"`),
    text(cx, floor - 110, "TAMPWISE", { size: 34, weight: 800, fill: "#9a9aa0", spacing: 8 }),
  );
}

export function thermometer(canvas) {
  const cx = 520;
  const cy = 420;
  shadow(canvas, 600, 1000, 160, 26, 0.6);
  canvas.add(
    `<path d="M${cx + 6} ${cy + 140} L${cx + 6} ${cy + 620} L${cx} ${cy + 650} L${cx - 6} ${cy + 620} L${cx - 6} ${cy + 140} Z" fill="${roundShade(canvas, CHROME, { gloss: 0.6, edge: 0.5 })}"/>`,
    `<circle cx="${cx}" cy="${cy}" r="170" fill="${roundShade(canvas, CHROME, { gloss: 0.6, edge: 0.5 })}"/>`,
    `<circle cx="${cx}" cy="${cy}" r="145" fill="#fbfaf6"/>`,
    `<path d="M${cx + 70} ${cy + 95} A115 115 0 0 0 ${cx + 110} ${cy + 20}" fill="none" stroke="#3aa35b" stroke-width="22"/>`,
    `<path d="M${cx - 110} ${cy + 20} A115 115 0 0 1 ${cx + 110} ${cy + 20}" fill="none" stroke="#2b2b2b" stroke-width="4" stroke-dasharray="3 14"/>`,
    `<path d="M${cx} ${cy} L${cx + 84} ${cy + 46}" stroke="#c0392b" stroke-width="7" stroke-linecap="round"/>`,
    `<circle cx="${cx}" cy="${cy}" r="12" fill="#2b2b2b"/>`,
    text(cx, cy - 60, "°C", { size: 40, weight: 700, fill: "#2b2b2b" }),
    `<path d="M${cx + 30} ${cy + 220} q60 0 60 40 v80" fill="none" stroke="${CHROME}" stroke-width="14"/>`,
  );
}

export function iceMaker(canvas) {
  const x = 380;
  const top = 280;
  const w = 440;
  const h = 700;
  shadow(canvas, 600, top + h, 290, 40);
  canvas.add(
    `<path d="${roundedRect(x, top, w, h, 20)}" fill="${steelPanel(canvas)}"/>`,
    `<path d="${roundedRect(x + 40, top + 300, w - 80, 300, 16)}" fill="${canvas.linear(
      [
        [0, "#5d6a72"],
        [1, "#2c343a"],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
  );
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      canvas.add(
        `<rect x="${x + 70 + column * 64 + (row % 2) * 20}" y="${top + 470 + row * 38}" width="54" height="50" rx="10" fill="#e7f3f8" opacity="0.8" stroke="#ffffff" stroke-width="2"/>`,
      );
    }
  }
  canvas.add(
    `<path d="${roundedRect(x + 40, top + 300, w - 80, 300, 16)}" fill="${glassShade(canvas, "#dbe8ee")}"/>`,
    `<rect x="${x + 150}" y="${top + 620}" width="${w - 300}" height="18" rx="9" fill="${darken(STEEL, 0.4)}"/>`,
    `<path d="M${x + 40} ${top + 60} H${x + w - 40}" stroke="${darken(STEEL, 0.3)}" stroke-width="4"/>`,
    text(600, top + 160, "CREMA WORKS", { size: 28, weight: 800, fill: "#555b60", spacing: 6 }),
    text(600, top + 220, "25 кг / добу", { size: 32, weight: 700, fill: "#555b60" }),
  );
}

export function blender(canvas) {
  const cx = 600;
  const floor = 1010;
  shadow(canvas, cx, floor, 230, 40);
  canvas.add(
    `<path d="M${cx - 190} ${floor} L${cx - 160} ${floor - 230} H${cx + 160} L${cx + 190} ${floor} Z" fill="${roundShade(canvas, "#25262a", { gloss: 0.25, edge: 0.4 })}"/>`,
    `<circle cx="${cx}" cy="${floor - 120}" r="44" fill="${roundShade(canvas, CHROME, { gloss: 0.5, edge: 0.5 })}"/>`,
    `<circle cx="${cx}" cy="${floor - 120}" r="8" fill="#25262a"/>`,
  );
  const jar = `M${cx - 150} ${floor - 260} L${cx - 220} ${floor - 760} H${cx + 220} L${cx + 150} ${floor - 260} Z`;
  const clip = canvas.clip(`<path d="${jar}"/>`);
  canvas.add(
    `<g clip-path="${clip}"><rect x="${cx - 240}" y="${floor - 560}" width="480" height="320" fill="${canvas.linear(
      [
        [0, "#f2b6c5"],
        [1, "#c8577a"],
      ],
      { x2: 0, y2: 1 },
    )}"/></g>`,
    `<path d="${jar}" fill="${glassShade(canvas, "#e6eef1")}" stroke="#ffffff" stroke-width="4"/>`,
    `<path d="M${cx + 215} ${floor - 700} C${cx + 360} ${floor - 690} ${cx + 340} ${floor - 380} ${cx + 175} ${floor - 360}" fill="none" stroke="#2f3034" stroke-width="34" stroke-linecap="round"/>`,
    `<rect x="${cx - 230}" y="${floor - 800}" width="460" height="56" rx="18" fill="${roundShade(canvas, "#2f3034", { gloss: 0.25, edge: 0.4 })}"/>`,
    `<path d="M${cx - 120} ${floor - 300} Q${cx} ${floor - 330} ${cx + 120} ${floor - 300}" stroke="#a0a7ad" stroke-width="10" fill="none"/>`,
  );
}
