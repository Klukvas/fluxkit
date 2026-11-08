// Packaged goods of the coffee demo pictures: lids, sleeves, carriers, straws, stirrers, sugar, cartons, pouches, coffee
// bags and beans, ice bags, boxes, tins, bottles, napkins, bags, rolls, gloves, filters, cleaning products, cards.
import {
  TILT,
  boxFaces,
  darken,
  ellipse,
  frontArc,
  frustumSide,
  glassShade,
  lighten,
  mix,
  random,
  round,
  roundShade,
  seedOf,
  shadow,
  text,
} from "./lib.mjs";
import { paperCup, sipLid } from "./cups.mjs";

/* ---------- small helpers ---------- */

function faceShade(canvas, base, { light = 0.1, dark = 0.08 } = {}) {
  return canvas.linear(
    [
      [0, lighten(base, light)],
      [0.55, base],
      [1, darken(base, dark)],
    ],
    { x1: 0, y1: 0, x2: 1, y2: 1 },
  );
}

/** A box: front, side and top faces with their own shading; returns the geometry for labels. */
export function box(
  canvas,
  x,
  floor,
  width,
  height,
  depth,
  colour,
  { side = darken(colour, 0.22), top = lighten(colour, 0.12) } = {},
) {
  const y = floor - height;
  const faces = boxFaces(x, y, width, height, depth);
  shadow(
    canvas,
    x + width / 2 + faces.dx / 2,
    floor - faces.dy / 2,
    width * 0.62 + faces.dx / 2,
    depth * 0.3,
  );
  canvas.add(
    `<path d="${faces.side}" fill="${canvas.linear([
      [0, side],
      [1, darken(side, 0.12)],
    ])}"/>`,
    `<path d="${faces.top}" fill="${canvas.linear(
      [
        [0, top],
        [1, lighten(top, 0.1)],
      ],
      { x2: 1, y2: 0 },
    )}"/>`,
    `<path d="${faces.front}" fill="${faceShade(canvas, colour)}"/>`,
    `<path d="M${round(x)} ${round(y)} H${round(x + width)} L${round(x + width + faces.dx)} ${round(y - faces.dy)}" fill="none" stroke="${lighten(colour, 0.35)}" stroke-width="2" opacity="0.8"/>`,
  );
  return { x, y, width, height, ...faces };
}

/** One coffee bean, `size` = its length. */
export function bean(canvas, cx, cy, size, angle, colour = "#4a2a17") {
  const fill = canvas.radial(
    [
      [0, lighten(colour, 0.28)],
      [0.6, colour],
      [1, darken(colour, 0.35)],
    ],
    { cx: 0.38, cy: 0.35, r: 0.7 },
  );
  return `<g transform="rotate(${round(angle)} ${round(cx)} ${round(cy)})">${ellipse(cx, cy, size / 2, size * 0.36, `fill="${fill}"`)}<path d="M${round(cx - size * 0.4)} ${round(cy)} C${round(cx - size * 0.15)} ${round(cy - size * 0.12)} ${round(cx + size * 0.15)} ${round(cy + size * 0.12)} ${round(cx + size * 0.4)} ${round(cy)}" fill="none" stroke="${darken(colour, 0.55)}" stroke-width="${round(size * 0.06)}" stroke-linecap="round"/></g>`;
}

/** A loose heap of beans on the floor around (`cx`, `cy`). */
export function beanPile(canvas, cx, cy, width, count, name, colour) {
  const rnd = random(seedOf(name));
  const beans = [];
  for (let index = 0; index < count; index += 1) {
    const r = Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    const x = cx + Math.cos(a) * r * width * 0.5;
    const y = cy + Math.sin(a) * r * width * 0.16 - (1 - r) * width * 0.08;
    beans.push({ x, y, s: width * (0.075 + rnd() * 0.02), angle: rnd() * 180 });
  }
  beans.sort((a, b) => a.y - b.y);
  shadow(canvas, cx, cy + width * 0.06, width * 0.52, width * 0.1, 0.8);
  canvas.add(...beans.map((item) => bean(canvas, item.x, item.y, item.s, item.angle, colour)));
}

/* ---------- disposable ware ---------- */

/** A stack of lids with the top one in full: `kind` sip, dome or flat; `colour` black, white, kraft or clear. */
export function lidStack(canvas, cx, floor, r, kind, colour) {
  const base = { black: "#2a2a2c", white: "#f1f0ec", kraft: "#b88d60", clear: "#e8f1f4" }[colour];
  const count = 4;
  shadow(canvas, cx, floor, r * 1.15, r * TILT * 1.2);
  for (let index = 0; index < count; index += 1) {
    const y = floor - index * r * 0.07;
    const fill =
      colour === "clear"
        ? glassShade(canvas, "#e8f1f4")
        : roundShade(canvas, base, { gloss: 0.3, edge: 0.4 });
    canvas.add(
      `<path d="${frustumSide(cx, y - r * 0.08, y, r * 1.05, r * 1.02)}" fill="${fill}"/>`,
    );
    if (colour === "clear") {
      canvas.add(
        `<path d="${frontArc(cx, y - r * 0.08, r * 1.05, r * 1.05 * TILT)}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.8"/>`,
      );
    }
  }
  const top = floor - count * r * 0.07;
  if (kind === "sip") {
    sipLid(canvas, cx, top, r, base);
    return;
  }
  if (kind === "dome") {
    const dome = `M${round(cx - r * 1.03)} ${round(top - 4)} C${round(cx - r)} ${round(top - r * 1.05)} ${round(cx + r)} ${round(top - r * 1.05)} ${round(cx + r * 1.03)} ${round(top - 4)} Z`;
    canvas.add(
      ellipse(cx, top - 4, r * 1.05, r * 1.05 * TILT, `fill="#f4fafb" opacity="0.6"`),
      `<path d="${dome}" fill="${glassShade(canvas, "#e6f0f3")}"/>`,
      `<path d="${dome}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.85"/>`,
      `<path d="${dome}" fill="none" stroke="#9ab0b8" stroke-width="1.5" opacity="0.5"/>`,
      ellipse(
        cx,
        top - r * 0.77,
        r * 0.2,
        r * 0.06,
        `fill="#cfdde2" stroke="#ffffff" stroke-width="2"`,
      ),
      ellipse(
        cx,
        top - 4,
        r * 1.05,
        r * 1.05 * TILT,
        `fill="none" stroke="#ffffff" stroke-width="5" opacity="0.9"`,
      ),
      ellipse(
        cx,
        top - 4,
        r * 1.05,
        r * 1.05 * TILT,
        `fill="none" stroke="#9ab0b8" stroke-width="1.5" opacity="0.6"`,
      ),
    );
    return;
  }
  canvas.add(
    ellipse(
      cx,
      top - 6,
      r * 1.05,
      r * 1.05 * TILT,
      `fill="${canvas.linear(
        [
          [0, "#ffffff", 0.9],
          [1, "#dce8ec", 0.7],
        ],
        { x2: 0, y2: 1 },
      )}" stroke="#ffffff" stroke-width="4"`,
    ),
    ellipse(cx, top - 6, r * 0.8, r * 0.8 * TILT, `fill="none" stroke="#b9cbd1" stroke-width="2"`),
    `<path d="M${round(cx - r * 0.12)} ${round(top - 6)} H${round(cx + r * 0.12)} M${round(cx)} ${round(top - 6 - r * 0.05)} V${round(top - 6 + r * 0.05)}" stroke="#7d949c" stroke-width="5" stroke-linecap="round"/>`,
  );
}

/** Corrugated cup sleeves: one on a white cup and a nested stack beside it. */
export function sleeves(canvas) {
  paperCup(canvas, 760, 1000, "450 мл", 4.3, {
    paper: "white",
    sleeve: { brand: "CUPLIA", size: "350–450 мл" },
    lid: "black",
  });
  const kraft = "#9a6a42";
  for (let index = 0; index < 4; index += 1) {
    const cx = 360;
    const floor = 1010 - index * 30;
    const top = floor - 200;
    const r1 = 200;
    const r2 = 172;
    if (index === 0) shadow(canvas, cx, floor, r2 * 1.2, r2 * TILT);
    const side = frustumSide(cx, top, floor, r1, r2);
    canvas.add(
      ellipse(cx, top, r1, r1 * TILT, `fill="${darken(kraft, 0.35)}"`),
      `<path d="${side}" fill="${roundShade(canvas, kraft, { gloss: 0.2, edge: 0.35 })}"/>`,
      `<path d="${frontArc(cx, top, r1, r1 * TILT)}" fill="none" stroke="${lighten(kraft, 0.25)}" stroke-width="3"/>`,
    );
    if (index === 3) {
      canvas.add(
        text(cx, top + 120, "CUPLIA", { size: 48, weight: 800, fill: "#f3e3cc", spacing: 4 }),
      );
    }
  }
}

/** A moulded pulp carrier with two cups in it. */
export function carrier(canvas, slots) {
  const pulp = "#c9bba3";
  const cx = 600;
  const top = 860;
  const w = slots === 4 ? 420 : 400;
  const h = slots === 4 ? 150 : 90;
  shadow(canvas, cx, top + 70, w * 1.05, 90);
  const outline = (y) =>
    `M${cx - w} ${y} Q${cx - w} ${y - h} ${cx - w + 120} ${y - h} H${cx + w - 120} Q${cx + w} ${y - h} ${cx + w} ${y} Q${cx + w} ${y + h} ${cx + w - 120} ${y + h} H${cx - w + 120} Q${cx - w} ${y + h} ${cx - w} ${y} Z`;
  const texture = canvas.linear(
    [
      [0, lighten(pulp, 0.15)],
      [1, darken(pulp, 0.1)],
    ],
    { x2: 0, y2: 1 },
  );
  canvas.add(
    `<path d="${outline(top + 50)}" fill="${darken(pulp, 0.25)}"/>`,
    `<path d="${outline(top)}" fill="${texture}"/>`,
  );
  const holes =
    slots === 4
      ? [
          [-210, -60],
          [210, -60],
          [-210, 70],
          [210, 70],
        ]
      : [
          [-200, 0],
          [200, 0],
        ];
  for (const [dx, dy] of holes) {
    canvas.add(ellipse(cx + dx, top + dy, 125, 125 * TILT * 1.2, `fill="${darken(pulp, 0.4)}"`));
  }
  canvas.add(
    `<path d="M${cx - 40} ${top - h * 0.8} Q${cx} ${top - h * 1.6} ${cx + 40} ${top - h * 0.8} Q${cx} ${top + h * 0.6} ${cx - 40} ${top - h * 0.8} Z" fill="${lighten(pulp, 0.1)}" stroke="${darken(pulp, 0.15)}" stroke-width="2"/>`,
  );
  const cups =
    slots === 4
      ? [
          [-210, -60],
          [210, -60],
          [-210, 70],
        ]
      : [
          [-200, 0],
          [200, 0],
        ];
  for (const [index, [dx, dy]] of cups.entries()) {
    paperCup(canvas, cx + dx, top + dy + 20, "350 мл", 3, {
      paper: index % 2 === 0 ? "kraft" : "white",
      lid: index % 2 === 0 ? "black" : "white",
    });
  }
}

/** A standing bundle of straws in a paper band. */
export function strawBundle(canvas, straw, widthMm, label) {
  const cx = 600;
  const floor = 1030;
  const count = 15;
  const w = widthMm * 5.2;
  const rnd = random(seedOf(label + straw.colour));
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const row = index % 3;
    const x = cx + (index - count / 2) * w * 0.62 + (rnd() - 0.5) * 8;
    items.push({
      x,
      y: floor - row * 14 - 10,
      tilt: (x - cx) * 0.05 + (rnd() - 0.5) * 6,
      h: 760 + rnd() * 30,
    });
  }
  shadow(canvas, cx, floor, count * w * 0.36, 40);
  items.sort((a, b) => a.y - b.y);
  const stripes = [];
  for (const item of items) {
    const shade = canvas.linear([
      [0, darken(straw.colour, 0.3)],
      [0.35, lighten(straw.colour, 0.3)],
      [0.6, straw.colour],
      [1, darken(straw.colour, 0.35)],
    ]);
    const x2 = item.x + item.tilt;
    const y2 = item.y - item.h;
    const path = `M${round(item.x - w / 2)} ${round(item.y)} L${round(x2 - w / 2)} ${round(y2)} L${round(x2 + w / 2)} ${round(y2)} L${round(item.x + w / 2)} ${round(item.y)} Z`;
    canvas.add(`<path d="${path}" fill="${straw.colour}"/>`);
    if (straw.stripe) {
      const clip = canvas.clip(`<path d="${path}"/>`);
      stripes.length = 0;
      for (let y = y2 - 40; y < item.y + 40; y += w * 2.4) {
        stripes.push(
          `<path d="M${round(item.x - w * 2)} ${round(y)} L${round(item.x + w * 2)} ${round(y - w * 1.3)} L${round(item.x + w * 2)} ${round(y - w * 0.3)} L${round(item.x - w * 2)} ${round(y + w)} Z" fill="${straw.stripe}"/>`,
        );
      }
      canvas.add(`<g clip-path="${clip}">${stripes.join("")}</g>`);
    }
    canvas.add(
      `<path d="${path}" fill="${shade}" opacity="0.6"/>`,
      ellipse(x2, y2, w / 2, w * 0.18, `fill="${darken(straw.colour, 0.5)}"`),
    );
  }
  // Paper band with the label.
  const bandY = floor - 330;
  const bw = count * w * 0.36 + 30;
  canvas.add(
    `<path d="M${round(cx - bw)} ${round(bandY - 60)} Q${cx} ${round(bandY - 40)} ${round(cx + bw)} ${round(bandY - 60)} V${round(bandY + 60)} Q${cx} ${round(bandY + 80)} ${round(cx - bw)} ${round(bandY + 60)} Z" fill="${roundShade(canvas, "#d9c3a0", { gloss: 0.2, edge: 0.3 })}"/>`,
    text(cx, bandY + 2, "CUPLIA", { size: 44, weight: 800, fill: "#4b3422", spacing: 5 }),
    text(cx, bandY + 48, label, { size: 34, weight: 600, fill: "#4b3422" }),
  );
}

/** Flat sticks fanned out on the floor (stirrers, sugar sticks): `stick` draws one at the origin, pointing right. */
function fan(canvas, count, spread, draw) {
  const cx = 600;
  const cy = 740;
  for (let index = 0; index < count; index += 1) {
    const angle = -spread / 2 + (spread * index) / Math.max(1, count - 1) - 90;
    canvas.add(
      `<g transform="translate(${cx} ${cy + 260}) rotate(${round(angle)}) translate(-38 0)">${draw(canvas, index)}</g>`,
    );
  }
}

export function stirrers(canvas, colour, lengthPx) {
  shadow(canvas, 600, 1000, 200, 40, 0.8);
  const shade = canvas.linear(
    [
      [0, lighten(colour, 0.18)],
      [0.5, colour],
      [1, darken(colour, 0.25)],
    ],
    { x2: 0, y2: 1 },
  );
  const grain = colour === "#d6b98a";
  fan(canvas, 13, 70, (c, index) => {
    const w = 34;
    return `<rect x="40" y="${-w / 2}" width="${lengthPx}" height="${w}" rx="${w / 2}" fill="${shade}" stroke="${darken(colour, 0.3)}" stroke-width="1.5"/>${grain ? `<path d="M80 -4 H${lengthPx - 30} M120 6 H${lengthPx - 80}" stroke="${darken(colour, 0.18)}" stroke-width="2" opacity="${0.4 + (index % 3) * 0.1}"/>` : `${ellipse(lengthPx + 20, 0, 26, 22, `fill="${shade}" stroke="${darken(colour, 0.3)}" stroke-width="1.5"`)}`}`;
  });
}

export function sugarSticks(canvas, paper, ink, label) {
  shadow(canvas, 600, 1000, 200, 40, 0.8);
  const shade = canvas.linear(
    [
      [0, lighten(paper, 0.2)],
      [0.45, paper],
      [1, darken(paper, 0.2)],
    ],
    { x2: 0, y2: 1 },
  );
  fan(canvas, 9, 64, (c, index) => {
    const w = 78;
    const length = 700;
    const teeth = [];
    for (let y = -w / 2; y < w / 2; y += 8) {
      teeth.push(`L${y % 16 === 0 ? 30 : 38} ${y + 8}`);
    }
    return `<path d="M38 ${-w / 2} H${length} V${w / 2} H38 Z" fill="${shade}" stroke="${darken(paper, 0.2)}" stroke-width="1.5"/>
      <path d="M38 ${-w / 2} ${teeth.join(" ")} L38 ${w / 2}" fill="${shade}" stroke="${darken(paper, 0.2)}" stroke-width="1"/>
      <rect x="${length - 30}" y="${-w / 2}" width="30" height="${w}" fill="${darken(paper, 0.08)}"/>
      ${index === 4 ? `<text x="${length / 2 + 20}" y="12" font-family="Inter, sans-serif" font-size="30" font-weight="700" fill="${ink}" text-anchor="middle" letter-spacing="2">${label}</text>` : `<path d="M150 0 H${length - 120}" stroke="${ink}" stroke-width="3" opacity="0.35"/>`}`;
  });
}

/* ---------- dairy ---------- */

/**
 * A 1 l carton (brick with a screw cap): `design` {base, accent, brand, line1, line2, volume}.
 */
export function carton(canvas, x, floor, scale, design) {
  const width = 200 * scale;
  const height = 380 * scale;
  const depth = 130 * scale;
  const geometry = box(canvas, x, floor, width, height, depth, design.base, {
    side: darken(design.base, 0.18),
    top: lighten(design.base, 0.05),
  });
  const { y, dx, dy } = geometry;
  const clip = canvas.clip(`<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`);
  const wave = `M${x} ${round(y + height * 0.62)} C${round(x + width * 0.3)} ${round(y + height * 0.55)} ${round(x + width * 0.65)} ${round(y + height * 0.7)} ${round(x + width)} ${round(y + height * 0.6)} V${round(y + height)} H${x} Z`;
  canvas.add(
    `<g clip-path="${clip}"><path d="${wave}" fill="${faceShade(canvas, design.accent, { light: 0.12, dark: 0.12 })}"/>
      <rect x="${x}" y="${y}" width="${width}" height="${round(height * 0.05)}" fill="${design.accent}" opacity="0.9"/></g>`,
    // The side seam strip and the side wave.
    `<path d="M${round(x + width)} ${round(y + height * 0.6)} L${round(x + width + dx)} ${round(y + height * 0.6 - dy)} V${round(y + height - dy)} L${round(x + width)} ${round(y + height)} Z" fill="${darken(design.accent, 0.2)}"/>`,
    text(x + width / 2, y + height * 0.2, design.brand, {
      size: round(30 * scale),
      weight: 800,
      fill: design.ink ?? darken(design.accent, 0.3),
      spacing: 2,
    }),
    text(x + width / 2, y + height * 0.33, design.line1, {
      size: round(34 * scale),
      weight: 800,
      fill: design.ink ?? darken(design.accent, 0.4),
    }),
    text(x + width / 2, y + height * 0.42, design.line2, {
      size: round(24 * scale),
      weight: 600,
      fill: design.ink ?? darken(design.accent, 0.4),
      opacity: 0.9,
    }),
    text(x + width / 2, y + height * 0.86, design.volume, {
      size: round(46 * scale),
      weight: 800,
      fill: "#ffffff",
    }),
  );
  // Screw cap on the top face, near the front left.
  const capX = x + width * 0.3 + dx * 0.45;
  const capY = y - dy * 0.45;
  const capR = 34 * scale;
  canvas.add(
    `<path d="${frustumSide(capX, capY - 34 * scale, capY, capR, capR)}" fill="${roundShade(canvas, design.cap ?? design.accent, { gloss: 0.35, edge: 0.4 })}"/>`,
    ellipse(
      capX,
      capY - 34 * scale,
      capR,
      capR * TILT * 1.4,
      `fill="${lighten(design.cap ?? design.accent, 0.2)}"`,
    ),
  );
}

/** A stand-up pouch with a cap (condensed milk), or a zip pouch: `design` {base, accent, brand, line1, line2, weight}. */
export function pouch(canvas, cx, floor, w, h, design) {
  const top = floor - h;
  const outline = `M${cx - w / 2} ${top + 30} Q${cx - w / 2 - 10} ${top + h * 0.5} ${cx - w / 2 + 14} ${floor - 18} Q${cx} ${floor + 14} ${cx + w / 2 - 14} ${floor - 18} Q${cx + w / 2 + 10} ${top + h * 0.5} ${cx + w / 2} ${top + 30} Z`;
  shadow(canvas, cx, floor, w * 0.58, w * 0.12);
  canvas.add(
    `<path d="${outline}" fill="${roundShade(canvas, design.base, { gloss: 0.28, edge: 0.32 })}"/>`,
    `<rect x="${cx - w / 2}" y="${top}" width="${w}" height="40" fill="${roundShade(canvas, darken(design.base, 0.05), { gloss: 0.2, edge: 0.25 })}"/>`,
    `<path d="M${cx - w / 2} ${top + 6} H${cx + w / 2} M${cx - w / 2} ${top + 16} H${cx + w / 2} M${cx - w / 2} ${top + 26} H${cx + w / 2}" stroke="${darken(design.base, 0.2)}" stroke-width="2" opacity="0.6"/>`,
  );
  if (design.zip) {
    canvas.add(
      `<path d="M${cx - w / 2 + 4} ${top + 64} H${cx + w / 2 - 4}" stroke="${darken(design.base, 0.25)}" stroke-width="4" opacity="0.6"/>`,
    );
  }
  if (design.cap) {
    const capX = cx + w * 0.22;
    canvas.add(
      `<path d="${frustumSide(capX, top - 46, top + 8, 34, 38)}" fill="${roundShade(canvas, design.cap, { gloss: 0.35, edge: 0.4 })}"/>`,
      ellipse(capX, top - 46, 34, 10, `fill="${lighten(design.cap, 0.25)}"`),
    );
  }
  const labelTop = top + h * 0.28;
  canvas.add(
    `<rect x="${cx - w * 0.36}" y="${labelTop}" width="${w * 0.72}" height="${h * 0.48}" rx="16" fill="${design.label ?? "#ffffff"}" opacity="0.95"/>`,
    text(cx, labelTop + h * 0.1, design.brand, {
      size: Math.round(w * 0.075),
      weight: 800,
      fill: design.accent,
      spacing: 3,
    }),
    text(cx, labelTop + h * 0.21, design.line1, {
      size: Math.round(w * 0.085),
      weight: 800,
      fill: darken(design.accent, 0.35),
    }),
    text(cx, labelTop + h * 0.29, design.line2, {
      size: Math.round(w * 0.055),
      weight: 600,
      fill: darken(design.accent, 0.2),
    }),
    text(cx, labelTop + h * 0.42, design.weight, {
      size: Math.round(w * 0.09),
      weight: 800,
      fill: design.accent,
    }),
  );
}

/* ---------- ice ---------- */

export function iceBag(canvas, cx, floor, w, h, shape, weight) {
  const top = floor - h;
  const outline = `M${cx - w / 2 + 20} ${top + 40} Q${cx - w / 2 - 30} ${top + h * 0.55} ${cx - w / 2 + 30} ${floor - 10} Q${cx} ${floor + 30} ${cx + w / 2 - 30} ${floor - 10} Q${cx + w / 2 + 30} ${top + h * 0.55} ${cx + w / 2 - 20} ${top + 40} Z`;
  const clip = canvas.clip(`<path d="${outline}"/>`);
  shadow(canvas, cx, floor + 10, w * 0.6, w * 0.12);
  const rnd = random(seedOf(shape + weight));
  const pieces = [];
  for (let index = 0; index < 70; index += 1) {
    const x = cx + (rnd() - 0.5) * w * 1.05;
    const y = top + 60 + Math.pow(rnd(), 0.6) * (h - 60);
    const s =
      shape === "crushed"
        ? 24 + rnd() * 26
        : shape === "nugget"
          ? 30 + rnd() * 10
          : 62 + rnd() * 12;
    const angle = rnd() * 90;
    const piece =
      shape === "crushed"
        ? `<path d="M${round(x)} ${round(y)} l${round(s)} ${round(s * 0.2)} l${round(-s * 0.3)} ${round(s * 0.8)} l${round(-s * 0.8)} ${round(-s * 0.2)} Z" fill="#ffffff" opacity="0.55" stroke="#cfe3ee" stroke-width="2"/>`
        : shape === "nugget"
          ? `<g transform="rotate(${round(angle)} ${round(x)} ${round(y)})"><rect x="${round(x - s / 2)}" y="${round(y - s * 0.35)}" width="${round(s)}" height="${round(s * 0.7)}" rx="${round(s * 0.3)}" fill="#ffffff" opacity="0.6" stroke="#cfe3ee" stroke-width="2"/></g>`
          : `<g transform="rotate(${round(angle)} ${round(x)} ${round(y)})"><rect x="${round(x - s / 2)}" y="${round(y - s / 2)}" width="${round(s)}" height="${round(s)}" rx="${round(s * 0.2)}" fill="#ffffff" opacity="0.5" stroke="#d5e7f0" stroke-width="2"/><rect x="${round(x - s * 0.35)}" y="${round(y - s * 0.35)}" width="${round(s * 0.3)}" height="${round(s * 0.12)}" rx="4" fill="#ffffff" opacity="0.9"/></g>`;
    pieces.push(piece);
  }
  canvas.add(
    `<path d="${outline}" fill="${canvas.linear(
      [
        [0, "#cfe4ef"],
        [1, "#a9cbe0"],
      ],
      { x2: 0, y2: 1 },
    )}"/>`,
    `<g clip-path="${clip}">${pieces.join("")}</g>`,
    `<path d="${outline}" fill="${glassShade(canvas, "#e8f4fa")}"/>`,
    // Heat seal at the top.
    `<rect x="${cx - w / 2 + 14}" y="${top + 6}" width="${w - 28}" height="44" rx="6" fill="${canvas.linear(
      [
        [0, "#f1f8fb"],
        [1, "#d6e9f2"],
      ],
      { x2: 0, y2: 1 },
    )}" opacity="0.95"/>`,
    `<path d="M${cx - w / 2 + 20} ${top + 18} H${cx + w / 2 - 20} M${cx - w / 2 + 20} ${top + 30} H${cx + w / 2 - 20}" stroke="#b8d3e1" stroke-width="2"/>`,
    // Printed band.
    `<g clip-path="${clip}"><rect x="${cx - w}" y="${top + h * 0.34}" width="${w * 2}" height="${h * 0.3}" fill="#1f5f99" opacity="0.92"/></g>`,
    text(cx, top + h * 0.45, "ICETTA", {
      size: Math.round(w * 0.11),
      weight: 800,
      fill: "#ffffff",
      spacing: 6,
    }),
    text(
      cx,
      top + h * 0.52,
      { cubes: "лід кубиками", crushed: "лід дроблений", nugget: "лід гранульований" }[shape],
      { size: Math.round(w * 0.055), weight: 600, fill: "#d9ecfa" },
    ),
    text(cx, top + h * 0.605, weight, {
      size: Math.round(w * 0.085),
      weight: 800,
      fill: "#ffffff",
    }),
  );
}

/* ---------- coffee ---------- */

/**
 * A stand-up coffee bag with a degassing valve, an optional window with beans and a front label:
 * `design` {bag, label, ink, brand, line1, line2, weight, window}.
 */
export function coffeeBag(canvas, cx, floor, w, h, design) {
  const top = floor - h;
  const outline = `M${cx - w / 2} ${top + 50} L${cx - w / 2 - 6} ${floor - 30} Q${cx - w / 2 - 4} ${floor} ${cx - w / 2 + 30} ${floor} H${cx + w / 2 - 30} Q${cx + w / 2 + 4} ${floor} ${cx + w / 2 + 6} ${floor - 30} L${cx + w / 2} ${top + 50} Z`;
  shadow(canvas, cx, floor, w * 0.6, w * 0.12);
  const crimp = [];
  for (let x = cx - w / 2; x < cx + w / 2; x += 10) {
    crimp.push(`M${round(x)} ${top + 8} V${top + 46}`);
  }
  canvas.add(
    `<path d="${outline}" fill="${roundShade(canvas, design.bag, { gloss: 0.22, edge: 0.3 })}"/>`,
    `<rect x="${cx - w / 2}" y="${top}" width="${w}" height="56" rx="4" fill="${roundShade(canvas, darken(design.bag, 0.06), { gloss: 0.18, edge: 0.28 })}"/>`,
    `<path d="${crimp.join(" ")}" stroke="${darken(design.bag, 0.25)}" stroke-width="2" opacity="0.45"/>`,
    // Gusset fold lines at the bottom.
    `<path d="M${cx - w / 2 + 10} ${floor - 70} Q${cx} ${floor - 40} ${cx + w / 2 - 10} ${floor - 70}" fill="none" stroke="${darken(design.bag, 0.25)}" stroke-width="2.5" opacity="0.5"/>`,
  );
  // Valve.
  const vx = cx;
  const vy = top + 130;
  canvas.add(
    `<circle cx="${vx}" cy="${vy}" r="34" fill="${roundShade(canvas, darken(design.bag, 0.12), { gloss: 0.3, edge: 0.3 })}"/>`,
    `<circle cx="${vx}" cy="${vy}" r="18" fill="none" stroke="${lighten(design.bag, 0.25)}" stroke-width="3" opacity="0.7"/>`,
    `<circle cx="${vx}" cy="${vy}" r="5" fill="${darken(design.bag, 0.4)}"/>`,
  );
  const labelTop = top + h * 0.33;
  const labelH = h * (design.window ? 0.3 : 0.42);
  canvas.add(
    `<rect x="${cx - w * 0.38}" y="${round(labelTop)}" width="${round(w * 0.76)}" height="${round(labelH)}" rx="10" fill="${design.label}"/>`,
    text(cx, labelTop + labelH * 0.2, design.brand, {
      size: Math.round(w * 0.06),
      weight: 800,
      fill: design.ink,
      spacing: 4,
    }),
    `<path d="M${round(cx - w * 0.22)} ${round(labelTop + labelH * 0.28)} H${round(cx + w * 0.22)}" stroke="${design.ink}" stroke-width="2" opacity="0.5"/>`,
    text(cx, labelTop + labelH * 0.47, design.line1, {
      size: Math.round(w * 0.075),
      weight: 800,
      fill: design.ink,
    }),
    text(cx, labelTop + labelH * 0.64, design.line2, {
      size: Math.round(w * 0.05),
      weight: 600,
      fill: design.ink,
      opacity: 0.85,
    }),
    text(cx, labelTop + labelH * 0.86, design.weight, {
      size: Math.round(w * 0.065),
      weight: 800,
      fill: design.ink,
    }),
  );
  if (design.window) {
    const wy = labelTop + labelH + 24;
    const wh = floor - 90 - wy;
    const clip = canvas.clip(
      `<rect x="${cx - w * 0.3}" y="${round(wy)}" width="${round(w * 0.6)}" height="${round(wh)}" rx="${round(w * 0.1)}"/>`,
    );
    const rnd = random(seedOf(design.line1));
    const beans = [];
    for (let index = 0; index < 40; index += 1) {
      beans.push(
        bean(
          canvas,
          cx + (rnd() - 0.5) * w * 0.7,
          wy + rnd() * wh,
          w * 0.09,
          rnd() * 180,
          design.beans ?? "#4a2a17",
        ),
      );
    }
    canvas.add(
      `<g clip-path="${clip}"><rect x="${cx - w}" y="${round(wy)}" width="${w * 2}" height="${round(wh)}" fill="#2a170d"/>${beans.join("")}</g>`,
      `<rect x="${cx - w * 0.3}" y="${round(wy)}" width="${round(w * 0.6)}" height="${round(wh)}" rx="${round(w * 0.1)}" fill="${glassShade(canvas)}" stroke="${lighten(design.bag, 0.2)}" stroke-width="3"/>`,
    );
  }
}

/** A heap of ground coffee on the floor. */
export function groundHeap(canvas, cx, cy, w, colour = "#5a3620") {
  shadow(canvas, cx, cy, w * 0.55, w * 0.1, 0.7);
  const rnd = random(seedOf(`ground${cx}`));
  const grains = [];
  for (let index = 0; index < 140; index += 1) {
    const a = rnd() * Math.PI;
    const r = rnd();
    grains.push(
      `<circle cx="${round(cx + Math.cos(a) * r * w * 0.48)}" cy="${round(cy - Math.sin(a) * r * w * 0.18)}" r="${round(1.5 + rnd() * 2.5)}" fill="${rnd() > 0.5 ? lighten(colour, 0.25) : darken(colour, 0.3)}"/>`,
    );
  }
  canvas.add(
    `<path d="M${cx - w / 2} ${cy} Q${cx - w * 0.2} ${cy - w * 0.3} ${cx} ${cy - w * 0.32} Q${cx + w * 0.2} ${cy - w * 0.3} ${cx + w / 2} ${cy} Q${cx} ${cy + w * 0.08} ${cx - w / 2} ${cy} Z" fill="${canvas.radial(
      [
        [0, lighten(colour, 0.2)],
        [1, darken(colour, 0.2)],
      ],
      { cx: 0.4, cy: 0.3, r: 0.8 },
    )}"/>`,
    ...grains,
  );
}

/** One coffee capsule standing on its rim. */
export function capsule(canvas, cx, floor, r, colour) {
  shadow(canvas, cx, floor, r * 1.2, r * 0.3, 0.8);
  canvas.add(
    `<path d="${frustumSide(cx, floor - r * 0.15, floor, r * 1.18, r * 1.18)}" fill="${roundShade(canvas, colour, { gloss: 0.55, edge: 0.45 })}"/>`,
    ellipse(cx, floor - r * 0.15, r * 1.18, r * 1.18 * TILT, `fill="${lighten(colour, 0.25)}"`),
    `<path d="${frustumSide(cx, floor - r * 0.95, floor - r * 0.15, r * 0.62, r)}" fill="${roundShade(canvas, colour, { gloss: 0.6, edge: 0.45 })}"/>`,
    ellipse(
      cx,
      floor - r * 0.95,
      r * 0.62,
      r * 0.62 * TILT,
      `fill="${roundShade(canvas, lighten(colour, 0.1), { gloss: 0.5, edge: 0.3 })}"`,
    ),
  );
}

/* ---------- tea, cocoa, tins ---------- */

/** A pyramid tea bag with a string and a tag. */
export function pyramidBag(canvas, cx, floor, size, leaf) {
  shadow(canvas, cx, floor, size * 0.6, size * 0.12, 0.8);
  const top = floor - size * 0.95;
  canvas.add(
    `<path d="M${cx} ${top} L${cx - size * 0.55} ${floor} L${cx + size * 0.1} ${floor + size * 0.08} Z" fill="${mix(leaf, "#f3eee4", 0.55)}" opacity="0.95"/>`,
    `<path d="M${cx} ${top} L${cx + size * 0.1} ${floor + size * 0.08} L${cx + size * 0.55} ${floor - size * 0.05} Z" fill="${mix(leaf, "#e2dacb", 0.6)}" opacity="0.95"/>`,
    `<path d="M${cx - size * 0.3} ${floor - size * 0.1} Q${cx - size * 0.1} ${floor - size * 0.35} ${cx + size * 0.05} ${floor} " fill="${leaf}" opacity="0.6"/>`,
    `<path d="M${cx} ${top} L${cx - size * 0.55} ${floor} L${cx + size * 0.1} ${floor + size * 0.08} L${cx + size * 0.55} ${floor - size * 0.05} Z" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.8"/>`,
    `<path d="M${cx} ${top} C${cx + size * 0.3} ${top - size * 0.5} ${cx + size * 0.7} ${top - size * 0.1} ${cx + size * 0.75} ${floor - size * 0.25}" fill="none" stroke="#efe8da" stroke-width="3"/>`,
    `<rect x="${cx + size * 0.6}" y="${floor - size * 0.28}" width="${size * 0.32}" height="${size * 0.24}" rx="4" fill="#f7f3ea" stroke="#d6cdbb" stroke-width="2"/>`,
  );
}

/** A round tin with a lid and a label band. */
export function tin(canvas, cx, floor, r, h, design) {
  const top = floor - h;
  shadow(canvas, cx, floor, r * 1.15, r * TILT);
  canvas.add(
    `<path d="${frustumSide(cx, top + h * 0.18, floor, r, r)}" fill="${roundShade(canvas, design.body, { gloss: 0.45, edge: 0.4 })}"/>`,
    `<path d="${frustumSide(cx, top, top + h * 0.2, r * 1.02, r * 1.02)}" fill="${roundShade(canvas, design.lid, { gloss: 0.5, edge: 0.4 })}"/>`,
    ellipse(
      cx,
      top,
      r * 1.02,
      r * 1.02 * TILT,
      `fill="${canvas.linear(
        [
          [0, lighten(design.lid, 0.3)],
          [1, design.lid],
        ],
        { x2: 0, y2: 1 },
      )}"`,
    ),
    `<path d="${frustumSide(cx, top + h * 0.3, top + h * 0.88, r + 1, r + 1)}" fill="${roundShade(canvas, design.label, { gloss: 0.25, edge: 0.3 })}"/>`,
    text(cx, top + h * 0.3 + r * TILT + r * 0.24, design.brand, {
      size: Math.round(r * 0.17),
      weight: 800,
      fill: design.ink,
      spacing: 3,
    }),
    text(cx, top + h * 0.3 + r * TILT + r * 0.56, design.line1, {
      size: Math.round(r * 0.26),
      weight: 800,
      fill: design.ink,
    }),
    text(cx, top + h * 0.3 + r * TILT + r * 0.8, design.weight, {
      size: Math.round(r * 0.15),
      weight: 600,
      fill: design.ink,
      opacity: 0.85,
    }),
  );
}

/** A powder heap (matcha, cocoa). */
export function powderHeap(canvas, cx, cy, w, colour) {
  shadow(canvas, cx, cy, w * 0.5, w * 0.08, 0.6);
  canvas.add(
    `<path d="M${cx - w / 2} ${cy} Q${cx - w * 0.15} ${cy - w * 0.36} ${cx} ${cy - w * 0.36} Q${cx + w * 0.15} ${cy - w * 0.36} ${cx + w / 2} ${cy} Q${cx} ${cy + w * 0.08} ${cx - w / 2} ${cy} Z" fill="${canvas.radial(
      [
        [0, lighten(colour, 0.25)],
        [1, darken(colour, 0.15)],
      ],
      { cx: 0.4, cy: 0.25, r: 0.85 },
    )}"/>`,
  );
}

/* ---------- bottles ---------- */

/** A glass syrup bottle (`size` 1 = 1 l) with a pump or a cap, liquid colour and a label. */
export function syrupBottle(canvas, cx, floor, size, design) {
  const r = 82 * size;
  const bodyTop = floor - 420 * size;
  const shoulder = bodyTop - 70 * size;
  const neckR = 26 * size;
  const neckTop = shoulder - 80 * size;
  shadow(canvas, cx, floor, r * 1.15, r * TILT);
  const outline = `M${cx - r} ${floor - 12 * size} L${cx - r} ${bodyTop} C${cx - r} ${shoulder + 20 * size} ${cx - neckR} ${shoulder + 10 * size} ${cx - neckR} ${shoulder - 20 * size} V${neckTop} H${cx + neckR} V${shoulder - 20 * size} C${cx + neckR} ${shoulder + 10 * size} ${cx + r} ${shoulder + 20 * size} ${cx + r} ${bodyTop} L${cx + r} ${floor - 12 * size} Q${cx + r} ${floor + r * TILT * 0.8} ${cx} ${floor + r * TILT * 0.8} Q${cx - r} ${floor + r * TILT * 0.8} ${cx - r} ${floor - 12 * size} Z`;
  canvas.add(
    `<path d="${outline}" fill="${roundShade(canvas, design.liquid, { gloss: 0.35, edge: 0.45 })}"/>`,
    `<path d="${outline}" fill="${glassShade(canvas, lighten(design.liquid, 0.5))}" opacity="0.9"/>`,
  );
  const labelTop = bodyTop + 60 * size;
  const labelBottom = floor - 70 * size;
  canvas.add(
    `<path d="${frustumSide(cx, labelTop, labelBottom, r + 1, r + 1)}" fill="${roundShade(canvas, design.label, { gloss: 0.2, edge: 0.3 })}"/>`,
    text(cx, labelTop + (labelBottom - labelTop) * 0.22, "SIROPIA", {
      size: Math.round(26 * size),
      weight: 800,
      fill: design.ink,
      spacing: 4,
    }),
    text(cx, labelTop + (labelBottom - labelTop) * 0.5, design.flavour, {
      size: Math.round(design.flavour.length > 10 ? 25 * size : 32 * size),
      weight: 800,
      fill: design.ink,
    }),
    text(cx, labelTop + (labelBottom - labelTop) * 0.66, "сироп", {
      size: Math.round(22 * size),
      weight: 600,
      fill: design.ink,
      opacity: 0.8,
    }),
    text(cx, labelTop + (labelBottom - labelTop) * 0.88, design.volume, {
      size: Math.round(26 * size),
      weight: 800,
      fill: design.ink,
    }),
  );
  if (design.pump) {
    const collarTop = neckTop - 30 * size;
    const stemTop = collarTop - 90 * size;
    canvas.add(
      `<path d="${frustumSide(cx, collarTop, neckTop + 16 * size, 36 * size, 36 * size)}" fill="${roundShade(canvas, "#2b2b2d", { gloss: 0.3, edge: 0.4 })}"/>`,
      `<rect x="${cx - 9 * size}" y="${stemTop}" width="${18 * size}" height="${collarTop - stemTop}" fill="${roundShade(canvas, "#e5e5e5", { gloss: 0.4, edge: 0.4 })}"/>`,
      `<path d="M${cx - 40 * size} ${stemTop} H${cx + 120 * size} Q${cx + 140 * size} ${stemTop} ${cx + 140 * size} ${stemTop + 18 * size} L${cx + 136 * size} ${stemTop + 30 * size} H${cx + 110 * size} V${stemTop + 26 * size} H${cx - 40 * size} Z" fill="${canvas.linear(
        [
          [0, "#3a3a3d"],
          [1, "#1c1c1e"],
        ],
        { x2: 0, y2: 1 },
      )}"/>`,
      `<rect x="${cx - 46 * size}" y="${stemTop - 26 * size}" width="${92 * size}" height="${30 * size}" rx="${10 * size}" fill="${roundShade(canvas, "#2b2b2d", { gloss: 0.35, edge: 0.4 })}"/>`,
    );
  } else {
    canvas.add(
      `<path d="${frustumSide(cx, neckTop - 40 * size, neckTop + 12 * size, 32 * size, 32 * size)}" fill="${roundShade(canvas, design.cap ?? "#2b2b2d", { gloss: 0.35, edge: 0.4 })}"/>`,
      ellipse(
        cx,
        neckTop - 40 * size,
        32 * size,
        9 * size,
        `fill="${lighten(design.cap ?? "#2b2b2d", 0.2)}"`,
      ),
    );
  }
}

/** A squeeze bottle (sauces): opaque body, flip cap with a nozzle. */
export function squeezeBottle(canvas, cx, floor, design) {
  const r = 120;
  const top = floor - 520;
  shadow(canvas, cx, floor, r * 1.15, r * TILT);
  canvas.add(
    `<path d="${frustumSide(cx, top + 40, floor, r, r * 0.98)}" fill="${roundShade(canvas, design.body, { gloss: 0.35, edge: 0.4 })}"/>`,
    `<path d="M${cx - r} ${top + 40} Q${cx - r} ${top - 20} ${cx - 50} ${top - 30} H${cx + 50} Q${cx + r} ${top - 20} ${cx + r} ${top + 40} Z" fill="${roundShade(canvas, design.body, { gloss: 0.4, edge: 0.4 })}"/>`,
    `<path d="${frustumSide(cx, top - 90, top - 20, 52, 58)}" fill="${roundShade(canvas, "#2b2b2d", { gloss: 0.3, edge: 0.4 })}"/>`,
    `<path d="M${cx - 16} ${top - 90} L${cx - 6} ${top - 190} H${cx + 6} L${cx + 16} ${top - 90} Z" fill="${roundShade(canvas, "#2b2b2d", { gloss: 0.3, edge: 0.4 })}"/>`,
    `<path d="${frustumSide(cx, top + 120, floor - 70, r + 1, r * 0.99)}" fill="${roundShade(canvas, design.label, { gloss: 0.2, edge: 0.3 })}"/>`,
    text(cx, top + 185, "SIROPIA", { size: 28, weight: 800, fill: design.ink, spacing: 4 }),
    text(cx, top + 250, design.line1, {
      size: design.line1.length > 10 ? 30 : 38,
      weight: 800,
      fill: design.ink,
    }),
    text(cx, top + 300, "соус", { size: 26, weight: 600, fill: design.ink, opacity: 0.85 }),
    text(cx, floor - 100, "1 кг", { size: 34, weight: 800, fill: design.ink }),
  );
  const drop = design.body;
  canvas.add(
    `<path d="M${cx + 260} ${floor - 6} q-70 -6 -110 4 q50 16 110 -4 Z" fill="${drop}" opacity="0.9"/>`,
  );
}

/** An opaque plastic bottle for cleaning liquids. */
export function cleanerBottle(canvas, cx, floor, design) {
  const w = 300;
  const h = 560;
  const top = floor - h;
  const outline = `M${cx - w / 2} ${floor - 20} V${top + 120} Q${cx - w / 2} ${top + 60} ${cx - 50} ${top + 40} V${top} H${cx + 50} V${top + 40} Q${cx + w / 2} ${top + 60} ${cx + w / 2} ${top + 120} V${floor - 20} Q${cx + w / 2} ${floor} ${cx + w / 2 - 20} ${floor} H${cx - w / 2 + 20} Q${cx - w / 2} ${floor} ${cx - w / 2} ${floor - 20} Z`;
  shadow(canvas, cx, floor, w * 0.6, w * 0.12);
  canvas.add(
    `<path d="${outline}" fill="${roundShade(canvas, design.body, { gloss: 0.35, edge: 0.35 })}"/>`,
    `<rect x="${cx - 62}" y="${top - 70}" width="124" height="90" rx="12" fill="${roundShade(canvas, design.cap, { gloss: 0.35, edge: 0.4 })}"/>`,
    `<path d="M${cx - 62} ${top - 50} H${cx + 62} M${cx - 62} ${top - 30} H${cx + 62} M${cx - 62} ${top - 10} H${cx + 62}" stroke="${darken(design.cap, 0.25)}" stroke-width="3"/>`,
    `<rect x="${cx - w / 2 + 24}" y="${top + 170}" width="${w - 48}" height="300" rx="14" fill="${design.label}"/>`,
    text(cx, top + 225, "CLEANBREW", { size: 30, weight: 800, fill: "#ffffff", spacing: 3 }),
    text(cx, top + 300, design.line1, {
      size: design.line1.length > 12 ? 28 : 36,
      weight: 800,
      fill: "#ffffff",
    }),
    text(cx, top + 345, design.line2, { size: 24, weight: 600, fill: "#ffffff", opacity: 0.9 }),
    text(cx, top + 435, design.volume, { size: 38, weight: 800, fill: "#ffffff" }),
  );
}

/* ---------- packaging and paper ---------- */

export function napkinStack(canvas, colour, label, sizeText) {
  const x = 300;
  const floor = 980;
  const width = 520;
  const depth = 300;
  const layers = 22;
  const faces = boxFaces(x, floor - layers * 12, width, layers * 12, depth);
  shadow(canvas, x + width / 2 + faces.dx / 2, floor - faces.dy / 2, width * 0.66, 70);
  canvas.add(
    `<path d="${faces.side}" fill="${darken(colour, 0.18)}"/>`,
    `<path d="${faces.front}" fill="${darken(colour, 0.06)}"/>`,
  );
  const lines = [];
  for (let index = 1; index < layers; index += 1) {
    const y = floor - index * 12;
    lines.push(`M${x} ${y} H${x + width} L${round(x + width + faces.dx)} ${round(y - faces.dy)}`);
  }
  canvas.add(
    `<path d="${lines.join(" ")}" fill="none" stroke="${darken(colour, 0.28)}" stroke-width="2" opacity="0.8"/>`,
    `<path d="${lines.map((line) => line.replace(/M(\S+) (\S+)/, (m, a, b) => `M${a} ${Number(b) - 3}`)).join(" ")}" fill="none" stroke="${lighten(colour, 0.35)}" stroke-width="1.5" opacity="0.7"/>`,
    `<path d="${faces.top}" fill="${canvas.linear(
      [
        [0, lighten(colour, 0.12)],
        [1, colour],
      ],
      { x2: 1, y2: 1 },
    )}"/>`,
    // Fold lines on the top napkin.
    `<path d="M${round(x + width / 2 + faces.dx / 2)} ${round(floor - layers * 12 - faces.dy / 2 - 2)} m${round(-width / 2 - faces.dx / 2 + 20)} 0" stroke="${darken(colour, 0.12)}" stroke-width="2"/>`,
    `<path d="M${round(x + width / 2)} ${round(floor - layers * 12)} L${round(x + width / 2 + faces.dx)} ${round(floor - layers * 12 - faces.dy)}" stroke="${darken(colour, 0.1)}" stroke-width="2"/>`,
  );
  // Paper band around the stack.
  const bx = x + width * 0.62;
  canvas.add(
    `<path d="M${bx} ${floor - layers * 12} H${bx + 110} V${floor} H${bx} Z" fill="#3e5a4a"/>`,
    `<path d="M${bx} ${floor - layers * 12} L${round(bx + faces.dx)} ${round(floor - layers * 12 - faces.dy)} H${round(bx + 110 + faces.dx)} L${bx + 110} ${floor - layers * 12} Z" fill="#4c6d5a"/>`,
    text(bx + 55, floor - layers * 12 + 70, label, { size: 26, weight: 800, fill: "#ffffff" }),
    text(bx + 55, floor - layers * 12 + 110, sizeText, { size: 22, weight: 600, fill: "#ffffff" }),
  );
}

export function kraftBag(canvas) {
  const kraft = "#b58a5c";
  const geometry = box(canvas, 330, 1030, 470, 560, 200, kraft, {
    side: darken(kraft, 0.18),
    top: darken(kraft, 0.45),
  });
  const { x, y, width, dx, dy } = geometry;
  // The open top shows the inside.
  canvas.add(
    `<path d="M${x} ${y} L${round(x + dx)} ${round(y - dy)} H${round(x + width + dx)} L${x + width} ${y} Z" fill="${darken(kraft, 0.5)}"/>`,
    `<path d="M${x} ${y} H${x + width}" stroke="${lighten(kraft, 0.3)}" stroke-width="3"/>`,
    `<path d="M${x} ${y + 40} H${x + width}" stroke="${darken(kraft, 0.18)}" stroke-width="2" opacity="0.6"/>`,
    `<path d="M${x + width + dx * 0.5} ${y - dy * 0.5} V${y + 520 - dy * 0.5}" stroke="${darken(kraft, 0.3)}" stroke-width="2" opacity="0.6"/>`,
  );
  const handle = (x1, x2, yBase, back) =>
    `<path d="M${x1} ${yBase} C${x1} ${yBase - 230} ${x2} ${yBase - 230} ${x2} ${yBase}" fill="none" stroke="${back ? darken(kraft, 0.3) : kraft}" stroke-width="16" stroke-linecap="round"/><path d="M${x1} ${yBase} C${x1} ${yBase - 230} ${x2} ${yBase - 230} ${x2} ${yBase}" fill="none" stroke="${lighten(kraft, 0.2)}" stroke-width="4" stroke-dasharray="10 12" stroke-linecap="round"/>`;
  canvas.body.splice(
    canvas.body.length - 4,
    0,
    handle(x + 150 + dx, x + width - 150 + dx, y - dy + 30, true),
  );
  canvas.add(
    handle(x + 150, x + width - 150, y + 40, false),
    text(x + width / 2, y + 280, "CUPLIA", { size: 64, weight: 800, fill: "#4a3020", spacing: 8 }),
    text(x + width / 2, y + 330, "32 × 20 × 10 см", {
      size: 30,
      weight: 600,
      fill: "#4a3020",
      opacity: 0.85,
    }),
  );
}

export function pastryBag(canvas) {
  const kraft = "#c9a074";
  const x = 350;
  const top = 290;
  const w = 500;
  const h = 720;
  shadow(canvas, x + w / 2, top + h, w * 0.6, 50);
  const zig = [];
  for (let px = x; px <= x + w; px += 25) {
    zig.push(`L${px} ${top + (((px - x) / 25) % 2) === 0 ? top : top + 14}`);
  }
  canvas.add(
    `<path d="M${x} ${top + 14} ${zig.join(" ")} V${top + h} H${x} Z" fill="${roundShade(canvas, kraft, { gloss: 0.18, edge: 0.25 })}"/>`,
    `<path d="M${x} ${top + 110} H${x + w}" stroke="${darken(kraft, 0.2)}" stroke-width="3" opacity="0.6"/>`,
  );
  const wx = x + 90;
  const wy = top + 220;
  const ww = w - 180;
  const wh = 330;
  const clip = canvas.clip(`<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="24"/>`);
  const croissant = `M${wx + 40} ${wy + 230} C${wx + 60} ${wy + 90} ${wx + ww - 60} ${wy + 90} ${wx + ww - 40} ${wy + 230} C${wx + ww - 90} ${wy + 190} ${wx + 90} ${wy + 190} ${wx + 40} ${wy + 230} Z`;
  const ridges = [0.3, 0.42, 0.55, 0.68]
    .map(
      (f) =>
        `M${wx + ww * f} ${wy + 120} Q${wx + ww * (f + 0.03)} ${wy + 170} ${wx + ww * f} ${wy + 210}`,
    )
    .join(" ");
  canvas.add(
    `<g clip-path="${clip}"><rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="#efe6d6"/><path d="${croissant}" fill="${canvas.radial(
      [
        [0, "#e7b46a"],
        [0.7, "#c98a3d"],
        [1, "#9c6326"],
      ],
      { cx: 0.45, cy: 0.4, r: 0.7 },
    )}"/><path d="${ridges}" stroke="#8a5420" stroke-width="5" fill="none" opacity="0.6"/></g>`,
    `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="24" fill="${glassShade(canvas)}" stroke="${lighten(kraft, 0.3)}" stroke-width="4"/>`,
    text(x + w / 2, wy + wh + 80, "CUPLIA", { size: 44, weight: 800, fill: "#5a3d24", spacing: 6 }),
    text(x + w / 2, wy + wh + 125, "12 × 22 см", {
      size: 28,
      weight: 600,
      fill: "#5a3d24",
      opacity: 0.85,
    }),
  );
}

export function receiptRoll(canvas, cx, floor, r, h) {
  const top = floor - h;
  shadow(canvas, cx, floor, r * 1.15, r * TILT);
  const spiral = [];
  for (let k = 0.45; k < 0.98; k += 0.08) {
    spiral.push(
      ellipse(cx, top, r * k, r * k * TILT, `fill="none" stroke="#d9d6cf" stroke-width="1.5"`),
    );
  }
  canvas.add(
    `<path d="${frustumSide(cx, top, floor, r, r)}" fill="${roundShade(canvas, "#f6f5f1", { gloss: 0.2, edge: 0.25 })}"/>`,
    ellipse(cx, top, r, r * TILT, `fill="#fbfaf7"`),
    ...spiral,
    ellipse(cx, top, r * 0.32, r * 0.32 * TILT, `fill="#8a7a66"`),
    ellipse(cx, top, r * 0.24, r * 0.24 * TILT, `fill="#3d342c"`),
    `<path d="M${cx - r * 0.98} ${top + h * 0.3} Q${cx - r * 1.3} ${top + h * 0.75} ${cx - r * 1.1} ${floor + 30}" fill="none" stroke="#f3f1ec" stroke-width="10"/>`,
  );
}

export function gloveBox(canvas) {
  const geometry = box(canvas, 330, 1010, 500, 300, 280, "#f2f2f0", {
    side: "#d9d9d6",
    top: "#fbfbfa",
  });
  const { x, y, width, height, dx, dy } = geometry;
  canvas.add(
    `<rect x="${x}" y="${y + height * 0.35}" width="${width}" height="${height * 0.4}" fill="#26282c"/>`,
    text(x + width / 2, y + height * 0.52, "NITRILE", {
      size: 44,
      weight: 800,
      fill: "#ffffff",
      spacing: 6,
    }),
    text(x + width / 2, y + height * 0.67, "100 шт. · S M L XL", {
      size: 28,
      weight: 600,
      fill: "#d8d8d8",
    }),
    text(x + width / 2, y + height * 0.22, "CUPLIA", {
      size: 34,
      weight: 800,
      fill: "#26282c",
      spacing: 6,
    }),
    // Dispenser slot on the top face and a glove coming out of it.
    ellipse(x + width / 2 + dx / 2, y - dy / 2, width * 0.25, dy * 0.22, `fill="#9a9a96"`),
  );
  const gx = x + width / 2 + dx / 2;
  const gy = y - dy / 2;
  const glove = `M${gx - 70} ${gy} C${gx - 90} ${gy - 120} ${gx - 120} ${gy - 160} ${gx - 140} ${gy - 230} q-6 -26 18 -26 q20 2 26 30 L${gx - 70} ${gy - 170} L${gx - 76} ${gy - 300} q2 -26 24 -24 q20 4 20 30 L${gx - 34} ${gy - 190} L${gx - 24} ${gy - 330} q4 -26 26 -22 q20 4 18 30 L${gx + 14} ${gy - 190} L${gx + 30} ${gy - 310} q6 -24 26 -18 q18 6 14 30 L${gx + 50} ${gy - 170} L${gx + 82} ${gy - 260} q10 -22 28 -12 q16 10 8 32 L${gx + 80} ${gy - 100} C${gx + 76} ${gy - 50} ${gx + 70} ${gy - 20} ${gx + 70} ${gy} Z`;
  canvas.add(
    `<path d="${glove}" fill="${canvas.linear([
      [0, "#3a3d43"],
      [0.4, "#55595f"],
      [1, "#1f2125"],
    ])}"/>`,
  );
}

/* ---------- filters and cleaning ---------- */

export function coneFilters(canvas) {
  // A stack of flat cone filters behind, a ceramic cone dripper with a filter on a cup in front.
  for (let index = 0; index < 5; index += 1) {
    const cx = 330 + index * 10;
    const top = 330 + index * 12;
    const floor = 860 + index * 8;
    const shape = `M${cx - 210} ${top} Q${cx} ${top - 34} ${cx + 210} ${top} L${cx + 60} ${floor} H${cx - 60} Z`;
    if (index === 0) shadow(canvas, 360, 880, 200, 30, 0.6);
    canvas.add(
      `<path d="${shape}" fill="${canvas.linear([
        [0, "#e8e5df"],
        [0.4, "#ffffff"],
        [1, "#dcd8d0"],
      ])}" stroke="#cbc6bc" stroke-width="2"/>`,
      `<path d="M${cx + 196} ${top + 8} L${cx + 50} ${floor - 4} M${cx - 56} ${floor - 12} H${cx + 56}" stroke="#d3cec5" stroke-width="12" opacity="0.9"/>`,
      `<path d="M${cx + 196} ${top + 8} L${cx + 50} ${floor - 4}" stroke="#bdb7ad" stroke-width="2" stroke-dasharray="3 7"/>`,
    );
  }
  canvas.add(text(395, 700, "02", { size: 64, weight: 800, fill: "#cfc9bf" }));
  paperCup(canvas, 800, 1040, "250 мл", 3.6, { paper: "white" });
  const cx = 800;
  const rimY = 445;
  const dripper = frustumSide(cx, rimY, rimY + 230, 210, 80);
  canvas.add(
    `<path d="${frustumSide(cx, rimY + 225, rimY + 262, 150, 150)}" fill="${roundShade(canvas, "#efece6", { gloss: 0.3, edge: 0.35 })}"/>`,
    `<path d="${dripper}" fill="${roundShade(canvas, "#f6f4ef", { gloss: 0.35, edge: 0.35 })}"/>`,
    ellipse(cx, rimY, 210, 210 * TILT, `fill="#ddd8cf"`),
    // The filter paper standing above the rim, open towards the viewer.
    `<path d="M${cx - 195} ${rimY} L${cx - 230} ${rimY - 120} Q${cx} ${rimY - 170} ${cx + 230} ${rimY - 120} L${cx + 195} ${rimY} Z" fill="${canvas.linear(
      [
        [0, "#e6e2da"],
        [0.4, "#ffffff"],
        [1, "#d9d4ca"],
      ],
    )}" stroke="#cfc9bf" stroke-width="2"/>`,
    ellipse(
      cx,
      rimY - 135,
      228,
      228 * TILT * 0.8,
      `fill="${canvas.linear(
        [
          [0, "#d6d0c6"],
          [1, "#f4f1ec"],
        ],
        { x2: 0, y2: 1 },
      )}" stroke="#cfc9bf" stroke-width="2"`,
    ),
    ellipse(
      cx,
      rimY - 125,
      150,
      150 * TILT * 0.7,
      `fill="${canvas.radial([
        [0, "#6b4126"],
        [1, "#4a2a17"],
      ])}"`,
    ),
    `<path d="M${cx + 200} ${rimY + 40} q70 10 60 80 q-10 50 -80 40" fill="none" stroke="#f1eee8" stroke-width="22"/>`,
  );
}

export function squareFilters(canvas) {
  for (let index = 0; index < 5; index += 1) {
    const x = 330 + index * 14;
    const y = 360 + index * 22;
    if (index === 0) shadow(canvas, 640, 960, 340, 50, 0.6);
    canvas.add(
      `<g transform="rotate(${-6 + index * 2} 600 650)"><rect x="${x}" y="${y}" width="540" height="540" rx="6" fill="${canvas.linear(
        [
          [0, "#ffffff"],
          [1, "#e7e3dc"],
        ],
        { x2: 1, y2: 1 },
      )}" stroke="#d4cfc6" stroke-width="2"/>
      <path d="M${x} ${y} L${x + 540} ${y + 540} M${x + 270} ${y} V${y + 540}" stroke="#dcd7cf" stroke-width="3"/></g>`,
    );
  }
}

export function cleaningTub(canvas) {
  const cx = 560;
  const floor = 1000;
  const r = 210;
  const h = 470;
  const top = floor - h;
  shadow(canvas, cx, floor, r * 1.15, r * TILT);
  canvas.add(
    `<path d="${frustumSide(cx, top + 80, floor, r, r * 0.96)}" fill="${roundShade(canvas, "#f3f4f6", { gloss: 0.3, edge: 0.3 })}"/>`,
    `<path d="${frustumSide(cx, top, top + 90, r * 1.03, r * 1.03)}" fill="${roundShade(canvas, "#1e6fb8", { gloss: 0.4, edge: 0.4 })}"/>`,
    ellipse(
      cx,
      top,
      r * 1.03,
      r * 1.03 * TILT,
      `fill="${canvas.linear(
        [
          [0, "#4c95d6"],
          [1, "#1e6fb8"],
        ],
        { x2: 0, y2: 1 },
      )}"`,
    ),
    `<path d="${frustumSide(cx, top + 130, floor - 30, r + 1, r * 0.965)}" fill="${roundShade(canvas, "#1e6fb8", { gloss: 0.25, edge: 0.35 })}"/>`,
    text(cx, top + 238, "CLEANBREW", { size: 32, weight: 800, fill: "#ffffff", spacing: 3 }),
    text(cx, top + 300, "таблетки", { size: 44, weight: 800, fill: "#ffffff" }),
    text(cx, top + 342, "для чищення групи", { size: 26, weight: 600, fill: "#dcecf9" }),
    text(cx, top + 395, "100 × 2 г", { size: 34, weight: 800, fill: "#ffffff" }),
  );
  for (const [dx, dy] of [
    [300, 30],
    [360, -10],
    [250, -20],
  ]) {
    const tx = cx + dx;
    const ty = floor + dy;
    canvas.add(
      ellipse(tx, ty + 6, 34, 10, `fill="#000" opacity="0.15"`),
      `<path d="${frustumSide(tx, ty - 14, ty, 32, 32)}" fill="${roundShade(canvas, "#f7f7f5", { gloss: 0.2, edge: 0.25 })}"/>`,
      ellipse(tx, ty - 14, 32, 10, `fill="#ffffff" stroke="#e3e3df" stroke-width="1"`),
    );
  }
}

export function brush(canvas) {
  const angle = -28;
  const shapes = (dark) => {
    const wood = dark
      ? "#000"
      : canvas.linear(
          [
            [0, "#8b5d3c"],
            [0.45, "#a8764f"],
            [1, "#4e3020"],
          ],
          { x2: 0, y2: 1 },
        );
    const metal = dark
      ? "#000"
      : canvas.linear(
          [
            [0, "#c8cdd1"],
            [0.45, "#ffffff"],
            [1, "#8d949a"],
          ],
          { x2: 0, y2: 1 },
        );
    const head = dark
      ? "#000"
      : canvas.linear(
          [
            [0, "#3a3a3d"],
            [1, "#141415"],
          ],
          { x2: 0, y2: 1 },
        );
    const bristles = [];
    for (let y = 572; y <= 698; y += 9) {
      bristles.push(`M990 ${y} L1090 ${y + (y - 635) * 0.25}`);
    }
    return `<rect x="200" y="608" width="600" height="54" rx="27" fill="${wood}"/>
      <rect x="780" y="596" width="70" height="78" rx="8" fill="${metal}"/>
      <rect x="840" y="560" width="160" height="150" rx="16" fill="${head}"/>
      <path d="${bristles.join(" ")}" stroke="${dark ? "#000" : "#2a2a2c"}" stroke-width="7" stroke-linecap="round"/>
      ${dark ? "" : `<path d="${bristles.join(" ")}" stroke="#6b6b70" stroke-width="2" stroke-linecap="round"/><circle cx="240" cy="635" r="9" fill="#3a2416"/>`}`;
  };
  canvas.add(
    `<g transform="translate(40 120) rotate(${angle} 600 640)" opacity="0.22" filter="${canvas.blur(14)}">${shapes(true)}</g>`,
    `<g transform="rotate(${angle} 600 640)">${shapes(false)}</g>`,
  );
}

/* ---------- digital ---------- */

export function giftCard(canvas) {
  shadow(canvas, 620, 940, 420, 50, 0.6);
  canvas.add(
    `<g transform="rotate(-8 600 650)">
      <rect x="230" y="420" width="760" height="470" rx="36" fill="${canvas.linear(
        [
          [0, "#6b3f24"],
          [0.55, "#3e2416"],
          [1, "#24140c"],
        ],
        { x2: 1, y2: 1 },
      )}"/>
      <rect x="230" y="420" width="760" height="470" rx="36" fill="${canvas.radial(
        [
          [0, "#ffffff", 0.18],
          [1, "#ffffff", 0],
        ],
        { cx: 0.25, cy: 0.15, r: 0.7 },
      )}"/>
      <circle cx="840" cy="560" r="90" fill="none" stroke="#e9c79a" stroke-width="6" opacity="0.6"/>
      <path d="M800 540 h80 v40 q0 40 -40 40 q-40 0 -40 -40 Z M880 548 q30 0 30 20 q0 20 -30 20" fill="none" stroke="#e9c79a" stroke-width="6"/>
      ${text(290, 520, "BREW SCHOOL", { size: 34, weight: 800, fill: "#e9c79a", anchor: "start", spacing: 6 })}
      ${text(290, 690, "Подарунковий", { size: 64, weight: 800, fill: "#fff7ec", anchor: "start" })}
      ${text(290, 760, "сертифікат", { size: 64, weight: 800, fill: "#fff7ec", anchor: "start" })}
      ${text(290, 840, "500 · 1000 · 2000 ₴", { size: 36, weight: 600, fill: "#e9c79a", anchor: "start" })}
    </g>`,
  );
}

export function guideTablet(canvas) {
  shadow(canvas, 620, 1010, 330, 50, 0.7);
  canvas.add(
    `<g transform="rotate(-5 600 640)">
      <rect x="320" y="190" width="560" height="800" rx="44" fill="${canvas.linear(
        [
          [0, "#3a3a3e"],
          [1, "#151517"],
        ],
        { x2: 1, y2: 1 },
      )}"/>
      <rect x="350" y="230" width="500" height="720" rx="12" fill="${canvas.linear(
        [
          [0, "#f3e9da"],
          [1, "#e2d2bb"],
        ],
        { x2: 0, y2: 1 },
      )}"/>
      <rect x="350" y="230" width="500" height="300" rx="12" fill="#4b2e1d"/>
      ${text(600, 330, "BREW SCHOOL", { size: 28, weight: 800, fill: "#e9c79a", spacing: 6 })}
      ${text(600, 420, "Посібник", { size: 62, weight: 800, fill: "#fff7ec" })}
      ${text(600, 485, "бариста", { size: 62, weight: 800, fill: "#fff7ec" })}
      ${text(600, 600, "еспресо і молоко", { size: 36, weight: 700, fill: "#4b2e1d" })}
      ${text(600, 650, "60 сторінок · PDF", { size: 28, weight: 600, fill: "#7a5a43" })}
      <path d="M520 760 h160 v70 q0 70 -80 70 q-80 0 -80 -70 Z M680 772 q50 0 50 32 q0 32 -50 32" fill="none" stroke="#4b2e1d" stroke-width="10"/>
      <path d="M560 740 q-14 -26 0 -46 M600 740 q-14 -26 0 -46 M640 740 q-14 -26 0 -46" fill="none" stroke="#9c7a5f" stroke-width="6" stroke-linecap="round"/>
    </g>`,
  );
}
