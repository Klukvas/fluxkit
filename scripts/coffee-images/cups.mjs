// Cups, lids, sleeves, carriers, straws, stirrers and sugar sticks of the coffee demo pictures.
import {
  TILT,
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
  shadow,
  text,
} from "./lib.mjs";

/** Real proportions in millimetres (top diameter, bottom diameter, height) of the cup sizes the catalog sells. */
export const CUP_SIZES = {
  "110 мл": [62, 45, 60],
  "250 мл": [80, 56, 94],
  "350 мл": [90, 60, 110],
  "450 мл": [90, 60, 135],
  "300 мл": [95, 58, 98],
  "400 мл": [95, 58, 118],
  "500 мл": [95, 60, 140],
};

export const PAPER = {
  white: { body: "#f4f2ee", rim: "#ffffff", inside: "#e2ddd5", ink: "#8b8378" },
  kraft: { body: "#c49a6c", rim: "#d8b48a", inside: "#d9c3a6", ink: "#6e5236" },
  black: { body: "#2b2b2d", rim: "#3d3d40", inside: "#1c1c1e", ink: "#b9b4ad" },
};

const LID = {
  black: "#2a2a2c",
  white: "#f1f0ec",
  kraft: "#b88d60",
  clear: "#e8f1f4",
};

/**
 * A paper cup standing on the floor at (`cx`, `floor`). `scale` is pixels per millimetre. Options: `paper` (white, kraft,
 * black), `wall` (single, double, ripple), `lid` (null, "black", "white", "kraft"), `sleeve` (null or {brand, size}),
 * `label` (size text printed near the bottom), `print` (null or {band, ink, lines}).
 */
export function paperCup(canvas, cx, floor, size, scale, options = {}) {
  const [topMm, bottomMm, heightMm] = CUP_SIZES[size];
  const paper = PAPER[options.paper ?? "white"];
  const rTop = (topMm / 2) * scale;
  const rBottom = (bottomMm / 2) * scale;
  const height = heightMm * scale;
  const top = floor - height;
  const bottom = floor;
  const at = (y) => rBottom + ((rTop - rBottom) * (bottom - y)) / height;
  shadow(canvas, cx + rBottom * 0.12, bottom + 2, rBottom * 1.25, rBottom * TILT * 1.1);

  const side = frustumSide(cx, top, bottom, rTop, rBottom);
  const clip = canvas.clip(`<path d="${side}"/>`);
  canvas.add(
    `<path d="${side}" fill="${roundShade(canvas, paper.body, { gloss: options.paper === "black" ? 0.22 : 0.3, edge: 0.32 })}"/>`,
  );

  if (options.print) {
    const { band, ink, lines } = options.print;
    const y1 = top + height * 0.3;
    const y2 = top + height * 0.66;
    canvas.add(
      `<g clip-path="${clip}"><path d="${frustumSide(cx, y1, y2, at(y1) + 2, at(y2) + 2)}" fill="${roundShade(canvas, band, { gloss: 0.18, edge: 0.35 })}"/></g>`,
      text(cx, y1 + (y2 - y1) * 0.5, lines[0], {
        size: Math.round(rTop * 0.17),
        weight: 800,
        fill: ink,
        spacing: 2,
      }),
      text(cx, y1 + (y2 - y1) * 0.78, lines[1], {
        size: Math.round(rTop * 0.12),
        weight: 600,
        fill: ink,
        spacing: 3,
        opacity: 0.85,
      }),
    );
  }

  if (options.wall === "ripple") {
    const lines = [];
    for (let index = -14; index <= 14; index += 1) {
      const f = index / 15;
      const x1 = cx + f * at(top + 18);
      const x2 = cx + f * rBottom;
      const light = index % 2 === 0;
      lines.push(
        `<path d="M${round(x1)} ${round(top + 18)} L${round(x2)} ${round(bottom - 4)}" stroke="${light ? "#ffffff" : darken(paper.body, 0.25)}" stroke-width="${round(Math.max(2, rTop * 0.03) * (1 - Math.abs(f) * 0.6))}" opacity="${light ? 0.55 : 0.35}"/>`,
      );
    }
    canvas.add(`<g clip-path="${clip}">${lines.join("")}</g>`);
  }
  if (options.wall === "double" || options.wall === "ripple") {
    // The outer wall ends a little under the rim.
    canvas.add(
      `<path d="${frontArc(cx, top + 16, at(top + 16), at(top + 16) * TILT)}" fill="none" stroke="${darken(paper.body, 0.22)}" stroke-width="2.5" opacity="0.7"/>`,
    );
  }
  // Side seam and the rolled bottom.
  canvas.add(
    `<g clip-path="${clip}"><path d="M${round(cx + rTop * 0.62)} ${round(top)} L${round(cx + rBottom * 0.62)} ${round(bottom)}" stroke="${darken(paper.body, 0.12)}" stroke-width="2" opacity="0.6"/></g>`,
    `<path d="${frontArc(cx, bottom - 7, rBottom * 0.99, rBottom * TILT)}" fill="none" stroke="${darken(paper.body, 0.18)}" stroke-width="3" opacity="0.6"/>`,
  );

  if (options.sleeve) {
    sleeveBand(canvas, cx, top + height * 0.3, top + height * 0.74, at, options.sleeve);
  }
  if (options.label && !options.sleeve) {
    const y = bottom - height * 0.12;
    canvas.add(
      text(cx - rBottom * 0.05, y, options.label, {
        size: Math.round(height * 0.055),
        weight: 600,
        fill: paper.ink,
        opacity: 0.9,
      }),
    );
  }

  if (options.lid) {
    sipLid(canvas, cx, top, rTop, options.lid);
  } else {
    // Open top: rolled rim and the inside.
    canvas.add(
      ellipse(cx, top, rTop + 3, (rTop + 3) * TILT, `fill="${paper.rim}"`),
      // Inside: the far wall is lit, the front wall's inner side falls into shadow.
      ellipse(
        cx,
        top + 1,
        rTop - 5,
        (rTop - 5) * TILT,
        `fill="${canvas.linear(
          [
            [0, lighten(paper.inside, 0.25)],
            [0.45, paper.inside],
            [1, darken(paper.inside, 0.35)],
          ],
          { x2: 0, y2: 1 },
        )}"`,
      ),
      ellipse(
        cx,
        top + (rTop - 5) * TILT * 0.35,
        (rTop - 5) * 0.8,
        (rTop - 5) * TILT * 0.55,
        `fill="${darken(paper.inside, 0.3)}" opacity="0.35" filter="${canvas.blur(rTop * 0.06)}"`,
      ),
      `<path d="${frontArc(cx, top, rTop + 3, (rTop + 3) * TILT)}" fill="none" stroke="${darken(paper.rim, 0.15)}" stroke-width="2"/>`,
    );
  }
  return { top, rTop };
}

function sleeveBand(canvas, cx, y1, y2, at, sleeve) {
  const kraft = "#9a6a42";
  const path = frustumSide(cx, y1, y2, at(y1) + 4, at(y2) + 4);
  const clip = canvas.clip(`<path d="${path}"/>`);
  const ribs = [];
  for (let index = -20; index <= 20; index += 1) {
    const f = index / 21;
    ribs.push(
      `<path d="M${round(cx + f * (at(y1) + 4))} ${round(y1)} L${round(cx + f * (at(y2) + 4))} ${round(y2 + 10)}" stroke="${darken(kraft, 0.25)}" stroke-width="1.6" opacity="${round(0.35 * (1 - Math.abs(f) * 0.5))}"/>`,
    );
  }
  const middle = (y1 + y2) / 2;
  canvas.add(
    `<path d="${path}" fill="${roundShade(canvas, kraft, { gloss: 0.2, edge: 0.35 })}"/>`,
    `<g clip-path="${clip}">${ribs.join("")}</g>`,
    `<path d="${frontArc(cx, y1, at(y1) + 4, (at(y1) + 4) * TILT)}" fill="none" stroke="${darken(kraft, 0.3)}" stroke-width="2"/>`,
  );
  if (sleeve.brand) {
    canvas.add(
      text(cx, middle + 8, sleeve.brand, {
        size: Math.round((y2 - y1) * 0.2),
        weight: 800,
        fill: "#f3e3cc",
        spacing: 4,
      }),
    );
  }
  if (sleeve.size) {
    canvas.add(
      text(cx, middle + (y2 - y1) * 0.3, sleeve.size, {
        size: Math.round((y2 - y1) * 0.13),
        weight: 600,
        fill: "#f3e3cc",
        opacity: 0.9,
      }),
    );
  }
}

/** A sip-through lid on a cup rim of radius `r` at `top`. */
export function sipLid(canvas, cx, top, r, colour) {
  const base = LID[colour] ?? colour;
  const rl = r * 1.05;
  const rimTop = top - r * 0.08;
  const plateau = top - r * 0.25;
  const rp = r * 0.86;
  canvas.add(
    `<path d="${frustumSide(cx, rimTop, top + r * 0.04, rl, rl)}" fill="${roundShade(canvas, base, { gloss: 0.35, edge: 0.4 })}"/>`,
    ellipse(
      cx,
      rimTop,
      rl,
      rl * TILT,
      `fill="${canvas.linear(
        [
          [0, lighten(base, 0.12)],
          [1, darken(base, 0.08)],
        ],
        { x2: 0, y2: 1 },
      )}"`,
    ),
    `<path d="${frustumSide(cx, plateau, rimTop + r * 0.02, rp, rp * 1.04)}" fill="${roundShade(canvas, base, { gloss: 0.4, edge: 0.35 })}"/>`,
    ellipse(
      cx,
      plateau,
      rp,
      rp * TILT,
      `fill="${canvas.linear(
        [
          [0, lighten(base, 0.22)],
          [1, base],
        ],
        { x2: 0, y2: 1 },
      )}"`,
    ),
    // Sip opening near the front edge and a vent hole at the back.
    `<rect x="${round(cx - rp * 0.18)}" y="${round(plateau + rp * TILT * 0.45)}" width="${round(rp * 0.36)}" height="${round(rp * 0.075)}" rx="${round(rp * 0.035)}" fill="${darken(base, 0.55)}"/>`,
    ellipse(
      cx + rp * 0.1,
      plateau - rp * TILT * 0.55,
      rp * 0.03,
      rp * 0.015,
      `fill="${darken(base, 0.5)}"`,
    ),
    `<path d="${frontArc(cx, plateau, rp, rp * TILT)}" fill="none" stroke="${lighten(base, 0.35)}" stroke-width="2" opacity="0.7"/>`,
  );
}

/** A clear cold-drink cup with an iced drink, a lid (dome or flat) and a straw. */
export function coldCup(canvas, cx, floor, size, scale, options = {}) {
  const [topMm, bottomMm, heightMm] = CUP_SIZES[size];
  const rTop = (topMm / 2) * scale;
  const rBottom = (bottomMm / 2) * scale;
  const height = heightMm * scale;
  const top = floor - height;
  const at = (y) => rBottom + ((rTop - rBottom) * (floor - y)) / height;
  shadow(canvas, cx, floor + 2, rBottom * 1.25, rBottom * TILT * 1.1, 0.8);
  const side = frustumSide(cx, top, floor, rTop, rBottom);
  const clip = canvas.clip(`<path d="${side}"/>`);
  const frosted = options.frosted === true;
  const fillTop = top + height * (options.fill ?? 0.12);
  const drink = options.drink ?? { top: "#e9d8c0", bottom: "#7b4a2a" };
  const rnd = random(Math.round(height * 7 + rTop));
  const ice = [];
  if (options.ice !== false) {
    for (let index = 0; index < 9; index += 1) {
      const y = fillTop + 20 + rnd() * height * 0.45;
      const w = rTop * (0.32 + rnd() * 0.12);
      const x = cx + (rnd() - 0.5) * at(y) * 1.2 - w / 2;
      const angle = (rnd() - 0.5) * 40;
      ice.push(
        `<g transform="rotate(${round(angle)} ${round(x + w / 2)} ${round(y + w / 2)})"><rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(w * 0.9)}" rx="${round(w * 0.18)}" fill="#ffffff" opacity="0.32"/><rect x="${round(x + w * 0.12)}" y="${round(y + w * 0.1)}" width="${round(w * 0.32)}" height="${round(w * 0.12)}" rx="${round(w * 0.06)}" fill="#ffffff" opacity="0.55"/></g>`,
      );
    }
  }
  const layers = canvas.linear(
    [
      [0, drink.top],
      [0.42, drink.top],
      [0.62, mix(drink.top, drink.bottom, 0.55)],
      [1, drink.bottom],
    ],
    { x2: 0, y2: 1 },
  );
  canvas.add(
    `<g clip-path="${clip}"><rect x="${round(cx - rTop)}" y="${round(fillTop)}" width="${round(rTop * 2)}" height="${round(floor - fillTop + 10)}" fill="${layers}"/>${ice.join("")}
      ${ellipse(cx, fillTop, at(fillTop), at(fillTop) * TILT, `fill="${lighten(drink.top, 0.15)}" opacity="0.9"`)}</g>`,
    `<path d="${side}" fill="${glassShade(canvas, frosted ? "#f3f6f7" : "#eef6f8")}"${frosted ? ' opacity="0.95"' : ""}/>`,
    `<path d="${side}" fill="none" stroke="#ffffff" stroke-width="2.5" opacity="0.7"/>`,
  );
  if (frosted) {
    canvas.add(`<path d="${side}" fill="#ffffff" opacity="0.28"/>`);
  }
  // Moulded rings near the top and the bottom.
  for (const y of [top + 14, floor - 10]) {
    canvas.add(
      `<path d="${frontArc(cx, y, at(y), at(y) * TILT)}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.6"/>`,
    );
  }
  const straw = options.straw ?? { colour: "#1d1d1f" };
  const lid = options.lid ?? "dome";
  const strawTop = top - (lid === "dome" ? rTop * 1.25 : rTop * 0.9);
  const strawPath = (x1, y1, x2, y2) => `M${round(x1)} ${round(y1)} L${round(x2)} ${round(y2)}`;
  const sx1 = cx + rTop * 0.32;
  const sx2 = cx + rTop * 0.05;
  // The straw inside the drink (behind the lid) and above it.
  canvas.add(
    `<g clip-path="${clip}"><path d="${strawPath(sx2, top, sx2 - rTop * 0.18, floor - 20)}" stroke="${straw.colour}" stroke-width="${round(scale * 7)}" stroke-linecap="round" opacity="0.75"/></g>`,
  );
  // Straw from the rim to its top, drawn under the clear lid (seen through it); the part above a dome is drawn again on top.
  strawStick(canvas, sx2, top - 4, sx1, strawTop, scale * 7, straw);
  if (lid === "dome") {
    const rimTop = top - 6;
    const dome = `M${round(cx - rTop * 1.03)} ${round(rimTop)} C${round(cx - rTop * 1.0)} ${round(top - rTop * 0.95)} ${round(cx + rTop * 1.0)} ${round(top - rTop * 0.95)} ${round(cx + rTop * 1.03)} ${round(rimTop)} Z`;
    canvas.add(
      `<path d="${dome}" fill="${glassShade(canvas, "#eef6f8")}"/>`,
      `<path d="${dome}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.8"/>`,
      ellipse(
        cx,
        rimTop,
        rTop * 1.04,
        rTop * 1.04 * TILT,
        `fill="none" stroke="#ffffff" stroke-width="5" opacity="0.85"`,
      ),
      ellipse(cx, top - rTop * 0.66, rTop * 0.18, rTop * 0.05, `fill="#ffffff" opacity="0.7"`),
    );
  } else {
    canvas.add(
      `<path d="${frustumSide(cx, top - 10, top + 4, rTop * 1.04, rTop * 1.04)}" fill="${glassShade(canvas, "#eef6f8")}"/>`,
      ellipse(
        cx,
        top - 10,
        rTop * 1.04,
        rTop * 1.04 * TILT,
        `fill="#f4fafb" opacity="0.75" stroke="#ffffff" stroke-width="3"`,
      ),
      `<path d="M${round(cx - 12)} ${round(top - 10)} H${round(cx + 12)} M${round(cx)} ${round(top - 18)} V${round(top - 2)}" stroke="#9fb3ba" stroke-width="3"/>`,
    );
  }
  if (lid === "dome") {
    // The straw leaves through the hole at the top of the dome.
    const exit = top - rTop * 0.68;
    const f = (exit - (top - 4)) / (strawTop - (top - 4));
    strawStick(canvas, sx2 + (sx1 - sx2) * f, exit, sx1, strawTop, scale * 7, straw);
  }
  return { top, rTop };
}

/** One straw from (x1, y1) to (x2, y2), round shaded, optionally striped. */
export function strawStick(canvas, x1, y1, x2, y2, width, straw) {
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const shade = canvas.linear(
    [
      [0, darken(straw.colour, 0.35)],
      [0.3, lighten(straw.colour, 0.3)],
      [0.55, straw.colour],
      [1, darken(straw.colour, 0.4)],
    ],
    { x2: 0, y2: 1 },
  );
  const stripes = [];
  if (straw.stripe) {
    for (let offset = -length; offset < length; offset += width * 2.6) {
      stripes.push(
        `<path d="M${round(offset)} ${round(-width)} l${round(width * 1.2)} ${round(width * 2)} h${round(width * 1.1)} l${round(-width * 1.2)} ${round(-width * 2)} Z" fill="${straw.stripe}"/>`,
      );
    }
  }
  const clipId = canvas.clip(
    `<rect x="0" y="${round(-width / 2)}" width="${round(length)}" height="${round(width)}" rx="${round(width * 0.2)}"/>`,
  );
  canvas.add(
    `<g transform="translate(${round(x1)} ${round(y1)}) rotate(${round(angle)})">
      <rect x="0" y="${round(-width / 2)}" width="${round(length)}" height="${round(width)}" rx="${round(width * 0.2)}" fill="${straw.colour}"/>
      <g clip-path="${clipId}">${stripes.join("")}<rect x="0" y="${round(-width / 2)}" width="${round(length)}" height="${round(width)}" fill="${shade}" opacity="0.55"/></g>
      ${ellipse(length, 0, width * 0.18, width / 2, `fill="${darken(straw.colour, 0.55)}"`)}
    </g>`,
  );
}
