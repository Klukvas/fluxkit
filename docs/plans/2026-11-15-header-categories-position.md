# Header: where the "Categories" picker sits at desktop width

Source: `docs/HANDOFF.md`, "Storefront UI round 4", open item "'Categories' before the logo at desktop width (owner to decide)". The owner
delegates such decisions to an agent council (2026-11-11); red zones (AGENTS.md section 14) still need the owner.

## What is there (checked on the demo at 1440 px and in the code)

- Template default `config/header.ts`: `blocks: ["menu", "logo", "navigation", "search", "controls"]`, `navigation.display: "picker"`.
- In `picker` mode the `menu` block is ONE `<details>` for every width (`PickerBlock`, `components/site-header.tsx`): the menu icon below
  `xl`, the text "Категорії" / "Categories" with a chevron from `xl`; the `navigation` block renders nothing. So the desktop row reads
  `[Категорії] [logo] [search] [language] [theme] [cart] [account]`.
- Moving `logo` before `menu` in the default `blocks` is refused by `isSupportedMenuPlace` (with `controls` after it the phone menu's
  panel was measured past the screen edge, PR 249).

## Options

| | Option | Contract |
| --- | --- | --- |
| A | Keep as is | none |
| B | CSS `order` at `xl` puts the logo first; DOM and focus order stay picker, logo | none, but visual order and Tab order differ |
| C | Split `picker` by width: `menu` = the phone menu below `xl` (top-level categories and links, as in `row`), `navigation` = the "Categories" disclosure from `xl` at its own place in `blocks` (after the logo by default). DOM order = visual order at every width | no field added; the `navigation.display` row of `docs/contracts/header-footer.md` changes (which block draws what) |
| D | A new field (for example `navigation.pickerPlace`), opt-in split | additive field |

## Council (2026-11-15, three Codex runs, read-only)

| Lens | Vote | Argument (short) |
| --- | --- | --- |
| UX and product | C | Logo, browse, search, utilities is the usual desktop hierarchy; A reads as the phone layout carried to desktop (weak default, not a bug); B makes Tab jump left then right. |
| Changeability (contract, forks) | D | C changes what an unchanged fork config renders (a fork with `navigation, menu, logo, controls` gets its desktop picker moved), so it is a contract change; D keeps omitted = today. |
| Accessibility and focus order | C | Visual, reading and Tab order agree at every width (desktop: logo, Categories, search, controls; phone: Menu, logo, search, controls); the copy that does not show is `display: none` as a whole, so one "Main navigation" and no extra Tab stops; duplicate only the top-level links. |

All three: B is rejected (focus order against visual order in a template); C and D each change the public contract, so the owner decides
(AGENTS.md sections 14 and 17).

Orchestrator's note for the owner: no version of the template is released yet (`0.0.0`, no tags; `display: "picker"` is under
"Unreleased" in `CHANGELOG.md`, added 2026-11-13). C therefore breaks no released contract: it amends a row added two days ago,
with a CHANGELOG line and the fork note. D would add a field whose only purpose is to keep a behaviour nobody has shipped.

## Recommendation (majority): C, after the owner's approval

- `picker`: `menu` renders the phone menu (`xl:hidden`, top-level categories, links, the phone theme switch), `navigation` renders the
  "Categories" disclosure (`max-xl:hidden`, categories with children in columns, links; no theme switch, the `theme` control shows at that
  width). `row` is unchanged.
- The desktop panel's side follows the `navigation` block's place. As built: it opens towards the start when a shown search box precedes
  the picker (the box grows from `lg`, so the picker then sits at the end of the row), otherwise towards the end (`pickerPanelAlign`);
  the "first half of the row" rule above would have opened it the wrong way for `logo, search, navigation, controls` with search off.
  Bounds checked in a browser at 1280 px for the default order only (the e2e suite builds one config).
- Cost: the top-level category links and the configured links are in the markup twice (one copy always `display: none`, as in `row`);
  the header stays under the 8 000-byte cap of `shell.spec.tsx` (measured in the PR).
- Tests: the `header-footer-defaults` snapshots, `header-layout.spec.ts`, an e2e of the header's Tab order at 1280 and 390 px (closed
  header and into the open panel), one "Main navigation" exposed per width, visual exceptions for the header.
- Docs: `docs/contracts/header-footer.md` (the `navigation.display` row), `config/header.ts` comment, `CHANGELOG.md`, the fork note in
  `docs/migrations/`, `docs/HANDOFF.md`.

## Owner decision

**C, approved by the owner on 2026-11-15** (through the orchestrator; answer to "C (recommended), D or A?": go with the
recommendation). This approves the change of the `navigation.display` row in `docs/contracts/header-footer.md` without a new field.

As built (branch `fix/header-categories-position`):

- `layout/header-layout.ts`: in `picker` mode `menu` gives the `row` menu (top-level categories and links, flat, theme switch below
  `sm`) and `navigation` gives the `picker` view (no `withTheme`); `pickerPanelAlign`.
- `components/site-header.tsx`: `PickerBlock` is `max-xl:hidden xl:static`, its summary the "Categories" text and chevron only. From
  `xl` the header row is the panel's containing block (`.fk-header-row` `xl:relative`), so the panel stays inside the row however wide
  a fork's logo is (independent review finding: with the panel under the button, a 480 px logo and no search box pushed it past
  1280 px); the narrow-width `.fk-picker*` rules are gone (the disclosure is hidden there).
- Independent review (Codex, 2026-11-15): approve with fixes; fixed: the panel anchoring above, complete Tab sequences with the
  islands loaded and one-row alignment in the e2e, keyboard entry into the phone menu, a comment that claimed more browser
  measurement than was done.
- Header markup 7 707 bytes in `shell.spec.tsx`'s worst case (cap 8 000; 6 969 before).
- Docs: contract row, `config/header.ts` comment, `docs/customization.md`, `CHANGELOG.md`, the update section of
  `docs/migrations/2026-11-13-storefront-header-footer-round-4.md` (how to keep "Categories" before the logo), `docs/files/storefront.md`,
  `docs/HANDOFF.md`.
- Tests: `header-layout.spec.ts`, `header-footer-config.spec.tsx`, `shell.spec.tsx`, the frozen `header-footer-defaults` snapshots, and
  `e2e/tests/header-footer-round-4.e2e.ts` (Tab order equals the order on screen at 1280 and 390 px, one "Main navigation" per width).
