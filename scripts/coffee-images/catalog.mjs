// Every picture of the coffee demo (`seeds/src/coffee/*`): file name (without `.webp`, under `seeds/assets/coffee/`) ->
// drawing. A drawing returns an SVG string (1200 x 1200) or `{svg, width, height}` for a banner (1280 x 640).
import { Canvas, studio, text } from "./lib.mjs";
import { coldCup, paperCup } from "./cups.mjs";
import {
  beanPile,
  box,
  brush,
  capsule,
  carrier,
  carton,
  cleanerBottle,
  cleaningTub,
  coffeeBag,
  coneFilters,
  giftCard,
  gloveBox,
  groundHeap,
  guideTablet,
  iceBag,
  kraftBag,
  lidStack,
  napkinStack,
  pastryBag,
  pouch,
  powderHeap,
  pyramidBag,
  receiptRoll,
  sleeves,
  squareFilters,
  squeezeBottle,
  stirrers,
  strawBundle,
  sugarSticks,
  syrupBottle,
  tin,
} from "./goods.mjs";
import {
  automaticMachine,
  bladeGrinder,
  blender,
  capsuleMachine,
  espressoMachine,
  grinder,
  groupCloseUp,
  iceMaker,
  kettle,
  knockBox,
  pitcher,
  portafilter,
  scale,
  tamper,
  thermometer,
} from "./machines.mjs";

/** Backdrop tint per catalog area. */
const TINT = {
  ware: "#e9e1d6",
  cold: "#dfe9ec",
  dairy: "#e4e9ef",
  ice: "#dde8ef",
  coffee: "#eadfd2",
  tea: "#e3e8dc",
  syrup: "#eee3da",
  equipment: "#e3e5e8",
  cleaning: "#e2e9e6",
  packaging: "#ebe4d9",
  digital: "#e6e2ec",
};

/** A studio picture; `zoom` scales the drawing around the floor point (600, 1020) for small objects. */
function scene(tint, draw, zoom = 1) {
  const canvas = new Canvas();
  studio(canvas, tint);
  const start = canvas.body.length;
  draw(canvas);
  if (zoom !== 1) {
    const drawn = canvas.body.splice(start);
    canvas.add(
      `<g transform="translate(600 1020) scale(${zoom}) translate(-600 -1020)">`,
      ...drawn,
      "</g>",
    );
  }
  return canvas.toString();
}

/** One to three cup sizes in a row (the front one lowest), like a supplier's range shot. */
function cupRange(paper, sizes, options = {}) {
  return scene(TINT.ware, (c) => {
    const scale = sizes.length === 1 ? 7 : sizes.length === 2 ? 4.6 : 4;
    const positions =
      sizes.length === 1 ? [600] : sizes.length === 2 ? [430, 790] : [300, 600, 905];
    const floors = sizes.length === 1 ? [960] : sizes.length === 2 ? [980, 1010] : [950, 1010, 975];
    const order = sizes.map((size, index) => index).sort((a, b) => floors[a] - floors[b]);
    for (const index of order) {
      const size = sizes[index];
      paperCup(c, positions[index], floors[index], size, scale, {
        paper,
        wall: options.wall,
        label: size,
        lid: options.lidOn?.includes(index) ? options.lid : null,
        sleeve: options.sleeveOn?.includes(index) ? { brand: "CUPLIA", size } : null,
        print: options.print,
      });
    }
  });
}

function lids(kind, colour, label) {
  return scene(TINT.ware, (c) => {
    lidStack(c, 600, 880, 300, kind, colour);
    c.add(text(600, 1070, label, { size: 44, weight: 700, fill: "#7a6e60" }));
  });
}

function cartonPair(design) {
  return scene(TINT.dairy, (c) => {
    carton(c, 250, 930, 1.3, design);
    carton(c, 560, 1010, 1.5, design);
  });
}

const MILK = {
  base: "#f7f8fa",
  accent: "#2f6db3",
  brand: "MILKORA",
  ink: "#1f4c80",
  cap: "#2f6db3",
};
const PLANT = { base: "#f4efe6", brand: "GREENFOLD" };

function bag(design, extras) {
  return scene(TINT.coffee, (c) => {
    coffeeBag(c, 560, 1010, 520, 760, design);
    extras?.(c);
  });
}

const ROAST = { bag: "#2a2a2c", label: "#efe5d5", ink: "#3a2416", brand: "ROAST HARBOR" };
const KRAFT_BAG = { bag: "#b78b5e", label: "#f4ecdf", ink: "#3a2416", brand: "ROAST HARBOR" };

function syrups(flavour, liquid, label, ink) {
  return scene(
    TINT.syrup,
    (c) => {
      syrupBottle(c, 400, 990, 0.72, {
        liquid,
        label,
        ink,
        flavour,
        volume: "250 мл",
        cap: "#2b2b2d",
      });
      syrupBottle(c, 760, 1010, 1, { liquid, label, ink, flavour, volume: "1 л", pump: true });
    },
    1.22,
  );
}

function sauce(line1, body, label, ink) {
  return scene(TINT.syrup, (c) => squeezeBottle(c, 600, 1010, { body, label, ink, line1 }), 1.2);
}

function teaBox(design, leaf) {
  return scene(
    TINT.tea,
    (c) => {
      const geometry = box(c, 260, 960, 470, 340, 260, design.base);
      const mid = geometry.x + 235;
      c.add(
        text(mid, geometry.y + 70, "LEAFLINE", {
          size: 34,
          weight: 800,
          fill: design.ink,
          spacing: 6,
        }),
        text(mid, geometry.y + 150, design.line1, { size: 54, weight: 800, fill: design.ink }),
        text(mid, geometry.y + 205, design.line2, {
          size: 30,
          weight: 600,
          fill: design.ink,
          opacity: 0.85,
        }),
        text(mid, geometry.y + 295, design.count, { size: 28, weight: 700, fill: design.ink }),
      );
      pyramidBag(c, 900, 1040, 180, leaf);
    },
    1.12,
  );
}

function cleaner(design) {
  return scene(TINT.cleaning, (c) => cleanerBottle(c, 600, 1010, design), 1.35);
}

/* ---------- banners (1280 x 640) ---------- */

function bannerCanvas(tint) {
  const canvas = new Canvas(1280, 640);
  studio(canvas, tint, { floorY: 0.78 });
  return canvas;
}

function bannerCoffeeToGo() {
  const c = bannerCanvas("#e7ddd0");
  paperCup(c, 380, 560, "250 мл", 3.2, { paper: "kraft", lid: "black" });
  paperCup(c, 900, 545, "450 мл", 3.0, { paper: "black", lid: "black" });
  paperCup(c, 640, 600, "350 мл", 3.4, {
    paper: "white",
    lid: "white",
    sleeve: { brand: "CUPLIA", size: "350 мл" },
  });
  return { svg: c.toString(), width: 1280, height: 640 };
}

function bannerCoffeeBeans() {
  const c = bannerCanvas("#eadfd2");
  beanPile(c, 210, 610, 220, 16, "banner-beans-2", "#563220");
  coffeeBag(c, 480, 600, 300, 470, {
    ...ROAST,
    line1: "Хаус-бленд",
    line2: "для еспресо",
    weight: "1 кг",
  });
  coffeeBag(c, 800, 590, 280, 430, {
    ...KRAFT_BAG,
    line1: "Колумбія",
    line2: "моносорт",
    weight: "250 г",
    window: true,
  });
  beanPile(c, 1080, 610, 260, 22, "banner-beans", "#4a2a17");
  return { svg: c.toString(), width: 1280, height: 640 };
}

/** Places a product drawing (1200 x 1200, standing on y = 1020 around x = 600) on the banner floor at `x`, scaled by `size`. */
function onBannerFloor(canvas, x, size, draw) {
  const start = canvas.body.length;
  draw(canvas);
  const drawn = canvas.body.splice(start);
  canvas.add(
    `<g transform="translate(${x} 540) scale(${size}) translate(-600 -1020)">`,
    ...drawn,
    "</g>",
  );
}

/** The equipment card banner: a grinder, a machine and a tamper on the studio floor, no words (the card's title says it). */
function bannerEquipmentCard() {
  const c = bannerCanvas(TINT.equipment);
  onBannerFloor(c, 330, 0.5, (canvas) => grinder(canvas, "flat"));
  onBannerFloor(c, 720, 0.6, (canvas) => espressoMachine(canvas, 1));
  onBannerFloor(c, 1050, 0.46, (canvas) => tamper(canvas));
  return { svg: c.toString(), width: 1280, height: 640 };
}

export const DRAWINGS = {
  /* cups and lids */
  "paper-cup-single-wall-white": () =>
    cupRange("white", ["250 мл", "350 мл", "450 мл"], { wall: "single", lid: "white", lidOn: [1] }),
  "paper-cup-double-wall-kraft": () =>
    cupRange("kraft", ["250 мл", "350 мл", "450 мл"], { wall: "double", lid: "black", lidOn: [2] }),
  "paper-cup-double-wall-black": () =>
    cupRange("black", ["250 мл", "350 мл", "450 мл"], {
      wall: "double",
      lid: "black",
      lidOn: [0, 2],
    }),
  "paper-cup-ripple-white": () =>
    cupRange("white", ["350 мл", "450 мл"], { wall: "ripple", lid: "black", lidOn: [1] }),
  "paper-cup-single-wall-kraft": () =>
    cupRange("kraft", ["250 мл", "350 мл", "450 мл"], {
      wall: "single",
      lid: "white",
      lidOn: [1],
      sleeveOn: [2],
    }),
  "paper-cup-coffee-to-go-print": () =>
    cupRange("white", ["250 мл", "350 мл"], {
      wall: "single",
      lid: "black",
      lidOn: [1],
      print: { band: "#5a3a26", ink: "#f5ebdd", lines: ["КАВА З СОБОЮ", "COFFEE TO GO"] },
    }),
  "paper-cup-espresso-110": () => cupRange("white", ["110 мл"], { wall: "single" }),
  "pet-cold-cup-clear": () =>
    scene(TINT.cold, (c) => {
      coldCup(c, 300, 960, "300 мл", 4, { lid: "flat", straw: { colour: "#1d1d1f" } });
      coldCup(c, 905, 975, "500 мл", 4, {
        lid: "dome",
        straw: { colour: "#1d1d1f" },
        drink: { top: "#f3e6cf", bottom: "#a0663d" },
      });
      coldCup(c, 600, 1030, "400 мл", 4, {
        lid: "dome",
        straw: { colour: "#f4f1ea", stripe: "#c8372d" },
      });
    }),
  "pp-cold-cup-frosted": () =>
    scene(TINT.cold, (c) => {
      coldCup(c, 420, 980, "400 мл", 4.4, {
        lid: "flat",
        frosted: true,
        straw: { colour: "#2d6a4f" },
        drink: { top: "#cfe8b8", bottom: "#6aa84f" },
      });
      coldCup(c, 790, 1020, "500 мл", 4.4, {
        lid: "flat",
        frosted: true,
        straw: { colour: "#1d1d1f" },
        drink: { top: "#f6d1dc", bottom: "#c2557a" },
      });
    }),
  "lid-dome-pet-95": () => lids("dome", "clear", "95 мм"),
  "lid-flat-pet-95": () => lids("flat", "clear", "95 мм"),
  "lid-sip-black": () => lids("sip", "black", "80 мм · 90 мм"),
  "lid-sip-white": () => lids("sip", "white", "80 мм · 90 мм"),
  "lid-paper-kraft": () => lids("sip", "kraft", "80 мм · 90 мм"),
  "cup-sleeve-kraft": () => scene(TINT.ware, (c) => sleeves(c)),
  "cup-carrier-pulp": () => scene(TINT.ware, (c) => carrier(c, 4)),

  /* straws, stirrers, sugar */
  "paper-straw-black": () =>
    scene(TINT.ware, (c) => strawBundle(c, { colour: "#232325" }, 8, "6 мм · 8 мм")),
  "paper-straw-striped": () =>
    scene(TINT.ware, (c) =>
      strawBundle(c, { colour: "#f6f3ec", stripe: "#c8372d" }, 8, "6 мм · 8 мм"),
    ),
  "paper-straw-smoothie": () =>
    scene(TINT.ware, (c) => strawBundle(c, { colour: "#4f8fc9", stripe: "#f4f1ea" }, 12, "12 мм")),
  "wooden-stirrer-140": () => scene(TINT.ware, (c) => stirrers(c, "#d6b98a", 470)),
  "plastic-stirrer-110": () => scene(TINT.ware, (c) => stirrers(c, "#2a2a2c", 380)),
  "sugar-sticks-white": () => scene(TINT.ware, (c) => sugarSticks(c, "#f7f5f0", "#6b5a48", "5 г")),
  "sugar-sticks-cane": () => scene(TINT.ware, (c) => sugarSticks(c, "#c99a68", "#4a3020", "4 г")),

  /* packaging and consumables */
  "napkins-kraft-1ply": () =>
    scene(TINT.packaging, (c) => napkinStack(c, "#c49a6c", "CUPLIA", "24×24"), 1.2),
  "napkins-white-2ply": () =>
    scene(TINT.packaging, (c) => napkinStack(c, "#f7f6f2", "CUPLIA", "33×33"), 1.2),
  "kraft-bag-handles": () => scene(TINT.packaging, (c) => kraftBag(c)),
  "pastry-bag-window": () => scene(TINT.packaging, (c) => pastryBag(c)),
  "receipt-roll-57": () =>
    scene(TINT.packaging, (c) => {
      receiptRoll(c, 420, 880, 150, 230);
      receiptRoll(c, 780, 900, 150, 230);
      receiptRoll(c, 600, 1030, 150, 230);
      c.add(text(600, 1150, "57 мм × 30 м", { size: 36, weight: 700, fill: "#7a6e60" }));
    }),
  "nitrile-gloves-black": () => scene(TINT.packaging, (c) => gloveBox(c)),

  /* milk and cream */
  "barista-milk-3-2": () =>
    cartonPair({ ...MILK, line1: "Barista", line2: "молоко 3,2 %", volume: "1 л" }),
  "lactose-free-milk-1-5": () =>
    cartonPair({
      ...MILK,
      accent: "#2f8f6b",
      ink: "#1f5f48",
      cap: "#2f8f6b",
      line1: "Без лактози",
      line2: "молоко 1,5 %",
      volume: "1 л",
    }),
  "oat-drink-barista": () =>
    cartonPair({
      ...PLANT,
      accent: "#c9a46a",
      ink: "#5a4224",
      cap: "#8a6a3a",
      line1: "Овес",
      line2: "Barista",
      volume: "1 л",
    }),
  "almond-drink-barista": () =>
    cartonPair({
      ...PLANT,
      accent: "#b97a56",
      ink: "#5a3420",
      cap: "#7a4a2c",
      line1: "Мигдаль",
      line2: "Barista",
      volume: "1 л",
    }),
  "coconut-drink-barista": () =>
    cartonPair({
      ...PLANT,
      accent: "#4a8a7a",
      ink: "#244a40",
      cap: "#2f6a5a",
      line1: "Кокос",
      line2: "Barista",
      volume: "1 л",
    }),
  "soy-drink-barista": () =>
    cartonPair({
      ...PLANT,
      accent: "#8aa04a",
      ink: "#3f4f1c",
      cap: "#5f7a2a",
      line1: "Соя",
      line2: "Barista",
      volume: "1 л",
    }),
  "cream-33": () =>
    scene(TINT.dairy, (c) => {
      carton(c, 250, 960, 1.05, {
        ...MILK,
        accent: "#c58b2a",
        ink: "#6e4a12",
        cap: "#c58b2a",
        line1: "Вершки",
        line2: "33 %",
        volume: "500 мл",
      });
      carton(c, 560, 1010, 1.45, {
        ...MILK,
        accent: "#c58b2a",
        ink: "#6e4a12",
        cap: "#c58b2a",
        line1: "Вершки",
        line2: "33 %",
        volume: "1 л",
      });
    }),
  "cream-10": () =>
    scene(TINT.dairy, (c) => {
      carton(c, 250, 960, 1.05, {
        ...MILK,
        accent: "#6a8fc4",
        ink: "#2c4a75",
        cap: "#6a8fc4",
        line1: "Вершки",
        line2: "10 % до кави",
        volume: "500 мл",
      });
      carton(c, 560, 1010, 1.45, {
        ...MILK,
        accent: "#6a8fc4",
        ink: "#2c4a75",
        cap: "#6a8fc4",
        line1: "Вершки",
        line2: "10 % до кави",
        volume: "1 л",
      });
    }),
  "condensed-milk-1kg": () =>
    scene(TINT.dairy, (c) =>
      pouch(c, 600, 1010, 520, 720, {
        base: "#f2efe8",
        accent: "#2f6db3",
        label: "#ffffff",
        brand: "MILKORA",
        line1: "Згущене молоко",
        line2: "з цукром 8,5 %",
        weight: "1 кг",
        cap: "#2f6db3",
      }),
    ),

  /* ice */
  "ice-cubes": () => scene(TINT.ice, (c) => iceBag(c, 600, 1020, 600, 760, "cubes", "2 кг · 5 кг")),
  "ice-crushed": () =>
    scene(TINT.ice, (c) => iceBag(c, 600, 1020, 600, 760, "crushed", "2 кг · 5 кг")),
  "ice-nugget": () =>
    scene(TINT.ice, (c) => iceBag(c, 600, 1020, 600, 760, "nugget", "2 кг · 5 кг")),

  /* coffee */
  "espresso-blend-house": () =>
    bag({ ...ROAST, line1: "Хаус-бленд", line2: "еспресо · 80/20", weight: "250 г · 1 кг" }, (c) =>
      beanPile(c, 950, 1040, 280, 26, "house", "#4a2a17"),
    ),
  "espresso-blend-dark": () =>
    bag(
      {
        ...ROAST,
        bag: "#1f1a17",
        line1: "Темна суміш",
        line2: "еспресо · 60/40",
        weight: "500 г · 1 кг",
      },
      (c) => beanPile(c, 950, 1040, 280, 26, "dark", "#2f1a0e"),
    ),
  "espresso-blend-arabica": () =>
    bag(
      {
        ...ROAST,
        bag: "#7a2e2a",
        line1: "Арабіка 100",
        line2: "еспресо-суміш",
        weight: "250 г · 1 кг",
      },
      (c) => beanPile(c, 950, 1040, 280, 26, "arabica", "#5a3420"),
    ),
  "arabica-brazil-cerrado": () =>
    bag(
      {
        ...KRAFT_BAG,
        line1: "Бразилія",
        line2: "Серрадо · натуральна",
        weight: "250 г · 1 кг",
        window: true,
      },
      (c) => beanPile(c, 950, 1040, 280, 24, "brazil", "#5a3420"),
    ),
  "arabica-ethiopia-yirgacheffe": () =>
    bag(
      {
        ...KRAFT_BAG,
        label: "#f2e6d0",
        line1: "Ефіопія",
        line2: "Іргачеффе · мита",
        weight: "250 г · 1 кг",
        window: true,
        beans: "#7a4a2a",
      },
      (c) => beanPile(c, 950, 1040, 280, 24, "ethiopia", "#7a4a2a"),
    ),
  "arabica-colombia-huila": () =>
    bag(
      {
        ...KRAFT_BAG,
        line1: "Колумбія",
        line2: "Уїла · мита",
        weight: "250 г · 1 кг",
        window: true,
      },
      (c) => beanPile(c, 950, 1040, 280, 24, "colombia", "#5a3420"),
    ),
  "decaf-colombia": () =>
    bag(
      { ...ROAST, bag: "#2f4a5f", line1: "Без кофеїну", line2: "Колумбія", weight: "250 г · 1 кг" },
      (c) => beanPile(c, 950, 1040, 280, 24, "decaf", "#5a3420"),
    ),
  "ground-coffee-classic": () =>
    bag(
      { ...ROAST, bag: "#8a2b25", line1: "Класика", line2: "мелена кава", weight: "250 г" },
      (c) => groundHeap(c, 960, 1040, 300),
    ),
  "instant-coffee-freeze-dried": () =>
    scene(TINT.coffee, (c) => {
      pouch(c, 560, 1010, 520, 720, {
        base: "#3a2a20",
        accent: "#8a5a34",
        label: "#f3e9da",
        brand: "ROAST HARBOR",
        line1: "Розчинна кава",
        line2: "сублімована",
        weight: "500 г",
        zip: true,
      });
      groundHeap(c, 960, 1040, 260, "#7a4a24");
    }),
  "coffee-capsules-intenso": () =>
    scene(
      TINT.coffee,
      (c) => {
        const geometry = box(c, 220, 900, 470, 300, 240, "#2a2a2c");
        c.add(
          text(geometry.x + 235, geometry.y + 80, "ROAST HARBOR", {
            size: 30,
            weight: 800,
            fill: "#e9c79a",
            spacing: 4,
          }),
          text(geometry.x + 235, geometry.y + 160, "Інтенсо", {
            size: 60,
            weight: 800,
            fill: "#ffffff",
          }),
          text(geometry.x + 235, geometry.y + 220, "капсули · 10 шт.", {
            size: 30,
            weight: 600,
            fill: "#d8d8d8",
          }),
        );
        capsule(c, 760, 1040, 90, "#8e2f2a");
        capsule(c, 930, 1000, 90, "#8e2f2a");
        capsule(c, 860, 1110, 90, "#8e2f2a");
      },
      1.08,
    ),
  "drip-bags-colombia": () =>
    scene(TINT.coffee, (c) => {
      const geometry = box(c, 220, 960, 480, 330, 260, "#e9dcc6");
      c.add(
        text(geometry.x + 240, geometry.y + 80, "ROAST HARBOR", {
          size: 30,
          weight: 800,
          fill: "#3a2416",
          spacing: 4,
        }),
        text(geometry.x + 240, geometry.y + 160, "Дрип-пакети", {
          size: 54,
          weight: 800,
          fill: "#3a2416",
        }),
        text(geometry.x + 240, geometry.y + 220, "Колумбія · 12 г", {
          size: 30,
          weight: 600,
          fill: "#5a3a26",
        }),
      );
      c.add(
        `<g transform="rotate(8 900 860)"><rect x="790" y="660" width="230" height="330" rx="10" fill="${c.linear(
          [
            [0, "#ffffff"],
            [1, "#e8e3da"],
          ],
          { x2: 1, y2: 1 },
        )}" stroke="#d6cfc2" stroke-width="3"/><rect x="790" y="660" width="230" height="40" fill="#e1d8c8"/>${text(905, 840, "drip", { size: 44, weight: 800, fill: "#7a5a43" })}</g>`,
      );
    }),

  /* tea and cocoa */
  "black-tea-pyramids": () =>
    teaBox(
      {
        base: "#2d3a2a",
        ink: "#f3ead8",
        line1: "Чорний чай",
        line2: "цейлонський, 2,5 г",
        count: "25 · 100 пірамідок",
      },
      "#3b2414",
    ),
  "green-tea-pyramids": () =>
    teaBox(
      {
        base: "#dfe8cf",
        ink: "#2f4a24",
        line1: "Зелений чай",
        line2: "сенча, 2 г",
        count: "25 · 100 пірамідок",
      },
      "#5f7a2a",
    ),
  "matcha-latte-grade": () =>
    scene(TINT.tea, (c) => {
      tin(c, 500, 1000, 200, 470, {
        body: "#2f5a35",
        lid: "#c9c5b8",
        label: "#f3efe4",
        ink: "#2f5a35",
        brand: "LEAFLINE",
        line1: "Матча",
        weight: "100 г · 500 г",
      });
      powderHeap(c, 900, 1040, 260, "#7aa846");
    }),
  "cocoa-powder": () =>
    scene(TINT.tea, (c) => {
      tin(c, 500, 1000, 200, 470, {
        body: "#5a2f1c",
        lid: "#c79a62",
        label: "#f3e6d4",
        ink: "#5a2f1c",
        brand: "LEAFLINE",
        line1: "Какао",
        weight: "500 г · 1 кг",
      });
      powderHeap(c, 900, 1040, 260, "#6b3a22");
    }),
  "hot-chocolate-mix": () =>
    scene(TINT.tea, (c) => {
      pouch(c, 560, 1010, 520, 720, {
        base: "#4a2618",
        accent: "#a0522d",
        label: "#f6ebdc",
        brand: "LEAFLINE",
        line1: "Гарячий шоколад",
        line2: "суміш для напою",
        weight: "1 кг",
        zip: true,
      });
      paperCup(c, 960, 1050, "250 мл", 2.6, { paper: "white" });
    }),

  /* syrups and sauces */
  "syrup-vanilla": () => syrups("Ваніль", "#e8c77a", "#fbf6ea", "#6b4f1d"),
  "syrup-caramel": () => syrups("Карамель", "#b8641e", "#fbf1e6", "#6b3a12"),
  "syrup-hazelnut": () => syrups("Лісовий горіх", "#8a5a2b", "#f6efe4", "#4f3218"),
  "syrup-coconut": () => syrups("Кокос", "#f1ece2", "#eef6f2", "#2f6a5a"),
  "syrup-salted-caramel": () => syrups("Солона карамель", "#c9792e", "#f4f6f8", "#3a4a5a"),
  "syrup-lavender": () => syrups("Лаванда", "#9b86c8", "#f6f2fb", "#4a3a78"),
  "sauce-chocolate": () => sauce("Шоколад", "#3b2014", "#f3e6d4", "#3b2014"),
  "sauce-caramel": () => sauce("Карамель", "#b0601c", "#fbf1e6", "#6b3a12"),
  "sauce-white-chocolate": () => sauce("Білий шоколад", "#efe6d2", "#4a3020", "#f6ead8"),

  /* equipment */
  "espresso-machine-1-group": () => scene(TINT.equipment, (c) => espressoMachine(c, 1)),
  "espresso-machine-1-group-detail": () => scene(TINT.equipment, (c) => groupCloseUp(c)),
  "espresso-machine-2-group": () => scene(TINT.equipment, (c) => espressoMachine(c, 2, "#8a2f2a")),
  "espresso-machine-automatic": () => scene(TINT.equipment, (c) => automaticMachine(c)),
  "capsule-machine": () => scene(TINT.equipment, (c) => capsuleMachine(c)),
  "grinder-on-demand-64": () => scene(TINT.equipment, (c) => grinder(c, "flat")),
  "grinder-filter-conical": () => scene(TINT.equipment, (c) => grinder(c, "conical")),
  "grinder-blade": () => scene(TINT.equipment, (c) => bladeGrinder(c), 1.3),
  "gooseneck-kettle": () => scene(TINT.equipment, (c) => kettle(c)),
  "barista-scale": () => scene(TINT.equipment, (c) => scale(c)),
  "tamper-steel": () => scene(TINT.equipment, (c) => tamper(c)),
  "milk-pitcher": () =>
    scene(TINT.equipment, (c) => {
      pitcher(c, 360, 940, 0.85);
      pitcher(c, 870, 960, 1.05);
      pitcher(c, 600, 1040, 1.3);
    }),
  "portafilter-bottomless": () => scene(TINT.equipment, (c) => portafilter(c)),
  "knock-box": () => scene(TINT.equipment, (c) => knockBox(c)),
  "milk-thermometer": () => scene(TINT.equipment, (c) => thermometer(c), 1.08),
  "ice-maker-25kg": () => scene(TINT.equipment, (c) => iceMaker(c)),
  "blender-pro": () => scene(TINT.equipment, (c) => blender(c)),

  /* filters and cleaning */
  "cone-paper-filters-02": () => scene(TINT.cleaning, (c) => coneFilters(c)),
  "flask-brewer-filters": () => scene(TINT.cleaning, (c) => squareFilters(c)),
  "cleaning-tablets": () => scene(TINT.cleaning, (c) => cleaningTub(c), 1.12),
  "milk-system-cleaner": () =>
    cleaner({
      body: "#f4f6f8",
      cap: "#1e6fb8",
      label: "#1e6fb8",
      line1: "Молочна система",
      line2: "засіб для чищення",
      volume: "1 л",
    }),
  "descaler-liquid": () =>
    cleaner({
      body: "#f4f6f8",
      cap: "#c0392b",
      label: "#c0392b",
      line1: "Від накипу",
      line2: "для кавомашин",
      volume: "1 л",
    }),
  "group-head-brush": () => scene(TINT.cleaning, (c) => brush(c)),

  /* digital */
  "barista-guide-pdf": () => scene(TINT.digital, (c) => guideTablet(c)),
  "gift-card": () => scene(TINT.digital, (c) => giftCard(c)),

  /* home banners */
  "banner-coffee-to-go": bannerCoffeeToGo,
  "banner-coffee-beans": bannerCoffeeBeans,
  "banner-equipment": bannerEquipmentCard,
};
