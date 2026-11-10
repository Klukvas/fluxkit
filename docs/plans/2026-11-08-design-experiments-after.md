# Design experiments: acceptance run A1 (2026-11-10)

Result of acceptance run A1 of plan `docs/plans/2026-11-08-design-changeability.md` (protocol 7.4). Same two scenarios and the same table
columns as the baseline `docs/plans/2026-11-08-design-experiments-baseline.md`, so the two compare row by row.

- Start commit of both runs: `15c0d98` (main after PR-H 251, before PR 252 and PR 253). Branches (read-only refs, never merged, no PRs):
  `origin/experiment/a1-rebrand` (1 commit) and `origin/experiment/a1-reshape` (9 commits).
- Authors: fresh agents (new context) that worked from `docs/customization.md` and `AGENTS.md`; protocol step 2 hygiene (model different from the plan's authors, no `git log` or `experiment/*`) was **not verified from the transcripts**; the baseline file was read only after the
  work. Numbers marked "reported" come from the agents' own reports; file and line counts are recomputed from `git diff --numstat 15c0d98`.
- Classification used here: `config` = fork-owned files, `config/` files, token and brand files, `public/**`; `new` = not in the
  merge-base; `core edit` = any other changed existing file. Fork-deletable specs that the guide names count as deletions, not edits; `brand.spec.ts` is edited in place (one test removed). The guide's single list of these specs (step 0.3) exists only since PR 253; at `15c0d98` the same deletions were named in the guide's sections. Hours: the protocol (7.4 step 4) asks for tool calls times the baseline's median call time; this document uses the agents' own estimates instead (deviation).
- After A1 the gaps it found were closed by PR 252 (storefront token overrides) and PR 253 (fork-friendly checks). **Neither run was
  repeated on the finished code**: section 4 says which gap each PR closes by construction and what is still open.

## 1. Verdict against the protocol (7.4 step 5)

| Criterion | Target | A1 measured | Result |
|---|---|---|---|
| Rebrand time to "tokens done" (informational, not a 7.4 criterion) | - | 30-45 min expert / 1.5-2 h newcomer (reported estimate) | - |
| Rebrand time to "client is happy" | at most 2 h expert, half a day newcomer | 3-4 h expert / about 1 day newcomer (reported estimate) | **not met** (baseline 6-8 h / 1.5-2 days: halved) |
| Rebrand core edits | 0 | 5 files: 4 non-test files and the test `brand-html.spec.ts` | **not met** at `15c0d98`; 2 files left after PR 252 and 253 (section 4) |
| Rebrand test edits | 0 | 1 undocumented (`apps/admin/brand-html.spec.ts`), 2 documented deletions | **not met** at `15c0d98`; closed by PR 253 |
| Reshape requests by config plus new files only | at least 3 of 5 | product code: 4 of 5 (R1, R2, R4, R5; R1 and R4 only partly, see the TODO column: no sale badge, Bestsellers shows the newest, brand logos are text, nothing checked visually). Strict protocol (a spec edit counts as core edit): 1 of 5 (R4) | product code met; strict not met at `15c0d98`; closed by PR 253 (section 4) |
| Conflicts in `config`/`new` files with three upstream edits | 0 | **not measured** | open |
| Runs per scenario | two, on different models, the worse counts | one | **not done** |

Honest summary: the plan's goal is reached in direction and size (rebrand effort roughly halved, 4 of 5 reshape requests without touching
product code), but A1 as protocol 7.4 defines it **failed on the strict criteria**. The plan stays open for the items in section 5. A re-run
of both scenarios on `main` at or after `951d0d1` (two models) is the way to turn the "closed by construction" rows into measurements.

## 2. Rebrand scenario (`experiment/a1-rebrand`)

Brief: the same "Verde Kopi" brief as the baseline (section 1.1 there): green palette with amber accent, serif display font from a system
stack, radii 4 px controls / 8 px cards, softer shadows, dark theme, shop name in header, footer, mail and meta, admin name and favicon.

### 2.1 Totals (baseline in the last column)

| Measure | A1 | Baseline |
|---|---|---|
| Diff | 17 files, +89/-210 (130 of the removed lines are deleted fork-deletable tests) | 20 files, +110/-105 |
| Commits | 1 | 5 |
| Tool calls | about 50 (reported) | not recorded; own work about 1.5 h |
| Estimate, tokens only | 30-45 min expert / 1.5-2 h newcomer | 2-3 h expert / 5-7 h newcomer |
| Estimate, "client is happy" | 3-4 h expert / about 1 day newcomer | 6-8 h expert / 1.5-2 days newcomer |
| Core edits | 5 files | 16 of 20 files (same classifier: `tokens.css` and the three demo SVGs count as `config`; no overrides file existed) |
| Tests edited | 1 not in the guide, 2 deletions the guide prescribes | 7 test files |

### 2.2 Steps

| Step | Files | Lines | Tool calls | Tests edited | What stayed TODO |
|---|---|---|---|---|---|
| 1 Palette, accent, role radii, shadows, serif display font | 1: `packages/theme/src/tokens.css` (config; edited in place because no storefront overrides file existed) | +60/-60 | about 12 | none (theme tests green first run, 120/120) | heading font only in the web UI |
| 2 Mail colours, mail radius, theme colour | 2: `packages/theme/src/email-theme.ts`, `theme-color.ts` (**core edit**: literal copies) | +11/-11 | about 4 | none | no `font.display` in `EmailTheme`, mail headings stay sans; accent not in mail; no logo in mail |
| 3 Shop name, title, description | 2: `messages-overrides/uk.json`, `en.json` (config) | +10/-2 | about 5 | none | mail sender name comes from the `EMAIL_FROM` display name (environment) |
| 4 Brand: SVG icon, `themeColor`, text logo | 2: `config/brand.ts`, new `public/brand/icon.svg`; plus guide-prescribed deletions | +3/-2, 130 lines of tests removed | about 7 | 2 deletions: the TEMPLATE-DEFAULT test in `brand.spec.ts` (-13), `header-footer-defaults.upstream.spec.tsx` with its 4 fixtures (-117) | no og image, no apple icon (client PNG), no graphic logo |
| 5 Admin name and favicon | 3: `apps/admin/src/messages/{en,uk}/common.json` (**core edit**), new `apps/admin/public/favicon.svg` | +5/-4 | about 5 | 1, **not in the guide**: `apps/admin/brand-html.spec.ts:68` pinned the literal "Fluxkit Admin" (-1) | admin headings do not use the display font |

Core edit list at `15c0d98` (5): `email-theme.ts`, `theme-color.ts`, `apps/admin/src/messages/en/common.json`, `uk/common.json`, plus the
test line in `brand-html.spec.ts`. `tokens.css` counts as `config` by the protocol, but it is an upstream-owned file: it would conflict on every
upstream colour change (baseline E10).

### 2.3 Baseline gaps closed by A1

E2 (accent token), E3 (role radii), E4 and E9 (logo, favicon, `theme-color`; og image still needs a client file), E1 (display font token),
E5 (shop name in 5 files: the storefront name now goes through the overrides files and the storefront test literals no longer pin it; the admin name still needed core edits in A1 and is closed only by PR 253). Still open from the baseline: E10
(no storefront overrides file; PR 252), the mail heading font.

## 3. Reshape scenario (`experiment/a1-reshape`)

Brief: the five requests of the baseline (section 2.1 there): portrait card with price pill, badges and heart; list/grid toggle; centred
header with split navigation, wide search row and announcement bar; home reordered with full-bleed hero, Bestsellers row, brand strip;
four-column footer with newsletter, social and payment icons.

### 3.1 Totals (baseline in the last column)

| Measure | A1 | Baseline |
|---|---|---|
| Diff | 39 files, +683/-176 (117 of the removed lines are the deleted `header-footer-defaults` fixtures) | 31 files, +859/-157 |
| Commits | 9: five `Fork R1..R5` (config and new files only) and four `CORE-EDIT` | 5 |
| Tool calls | about 84 (23 / 10 / 23 / 10 / 18, reported) | about 92 (15 / 25 / 15 / 25 / 12) |
| Core product code touched | R3 only (`site-header.tsx`, `layout/header-layout.ts`, `globals.css`) | every request |
| Spec files edited | 8 files, 9 edits (most are one `vi.mock` line); nothing left red | 5 spec files, 7 edits, one spec left red on purpose |
| Checks run by the agent | storefront tests green in all three vitest configs, lint, format, typecheck, boundaries, theme tests; `check:docs` **red** (section 4) | - |
| Not run | e2e (no Postgres), Chromium visual check of the centred header and hero overlay | - |

### 3.2 Steps

| Step | Files | Lines | Tool calls | Tests edited | What stayed TODO | Effort expert / newcomer |
|---|---|---|---|---|---|---|
| 1 Card (`214a52c`, `f52fd2e`) | 8 fork files: new `cards/portrait-card.tsx`, `favourite-button.tsx`, `favourite-action.tsx`; `cards/custom.ts`, `config/slots.tsx`, two `messages-extra`; deleted `config/slots.upstream.spec.ts` | +137/-16 | about 23 | 4 specs got one `vi.mock("./cards/custom")` line (`cards/registry.spec`, `slot-places.spec`, `search-results.spec`, `home-sections-default.spec`); 15 tests were red first | sale badge (no compare-at price in `ProductSummary` or `ProductCardModel`, API work); heart is a placeholder; small caps approximated with `uppercase tracking-wide` | S / M |
| 2 List/grid (`53bfbc5`, `e92a7b3`) | 2 fork files: new `cards/horizontal-card.tsx`, `custom.ts` | +81 | about 10 | 1: `catalog.spec` (pinned `grid grid-cols-1 gap-4`) | none (toggle ships in the template) | S / S |
| 3 Header (`5cc032f`, `ee4c47d`) | fork: new `announcement.ts`, `announcement-bar.tsx`, `config/header.ts`, `slots.tsx`, messages; **core**: `components/site-header.tsx` (new `CentredRow`), `layout/header-layout.ts` (`HeaderConfig.layout`), `app/globals.css` (`.fk-header-centred*`, `scroll-padding-top` 5 to 6.5rem) | +55/-120 fork, +81/-6 core in `site-header.tsx`, `header-layout.ts`, `globals.css` (the commit `ee4c47d` is +96/-14 with config and two specs); 117 of the fork commit's -120 are the deleted `header-footer-defaults` files | about 23 | 2: `shell.spec` (nav count 4 to 5), `slots.fork.spec` (row class) | announcement bar and "categories before the logo" need no core edit; a centred logo with navigation split in two and a search row below do (as the plan said); layout not checked in a browser | M / L |
| 4 Home (`32a259c`) | 7 fork files: new `hero-overlay.tsx`, `brand-logo-strip.tsx`; `config/home.ts`, `config/custom-sections.ts`, messages; deleted `home-template-default.upstream.spec.ts` | +119/-30 | about 10 | none (documented deletion only) | "Bestsellers" shows the newest (API has only `newest`); brand logos are text placeholders (a brand has no picture in the API); `config/home.ts` is upstream-owned although it is the mechanism | S / M |
| 5 Footer (`e6df050`, `5538f2a`) | 9 fork files: new `footer-columns.tsx`, `config/social.ts`, 3 SVGs in `public/payments/`; `config/footer.ts`, `slots.tsx`, messages | +171/-3 | about 18 | 2: `shell.spec`, `shop-pages.spec` (mock of `config/footer`; 3 tests red first) | newsletter is text only; social links go to `example.com`; payment icons are neutral placeholders; the 4,000-byte footer cap did not fire because `shell.spec` mocks the slots | S / M |

Reading the table honestly: R1, R2 and R5 were done fully through documented mechanisms, but each turned an upstream spec red because the
spec pinned the template's default markup while reading a fork-owned file. R4 was clean. R3 reached core, as the plan expected.

## 4. What closed which gap

| A1 finding | Where | Closed by | State on `main` |
|---|---|---|---|
| Palette edited in the upstream `tokens.css` (E10; would conflict with every upstream colour change) | rebrand 1 | PR 252: fork-owned `packages/theme/src/brand-overrides.css`, effective-token contrast and literal-copy checks, fork-style run of the theme tests | closed; not re-run by a fresh agent |
| Admin name and title needed edits in `apps/admin/src/messages/*/common.json` | rebrand 5 | PR 253: `apps/admin/src/messages-overrides/{uk,en}.json`, unknown key stops the build | closed; not re-run |
| `brand-html.spec.ts:68` pinned "Fluxkit Admin" | rebrand 5 | PR 253: no literal in the spec | closed |
| `pnpm check:docs` (CI job `docs`) red in a fork that fills its own config files | both | PR 253: `.fluxkit-fork` marker read from the base ref; contract-defining files stay guarded | closed; 40 self-tests, 6 tests on throw-away repositories |
| Card override and 4-column footer turn upstream specs red | reshape 1, 2, 5 | PR 253: `test-support/template-defaults.ts` plus one-line `vi.mock` in the template-markup specs; the suite also runs with `grid`/`list` overridden and a 4-column footer (`vitest.brand-fork.config.ts`, `vitest.home-fork.config.ts`) | closed; a fork no longer edits these specs |
| The deletable specs were named only in separate sections of the guide | both | PR 253: one list (step 0.3), checked against the files on disk (`customization-doc.spec.ts`) | closed |
| `email-theme.ts` and `theme-color.ts` are literal copies | rebrand 2 | not changed: the specs print the values to write | **open** (the 2 remaining core edits of a rebrand) |
| `EmailTheme` has no display font or accent | rebrand 2 | not changed: public interface | **open**, needs an owner decision |
| Centred header with logo in the middle and a search row | reshape 3 | not targeted by the plan (section 1, request 3) | **open**, stays a documented core edit; the bar itself is the `header.top` slot |
| `config/home.ts` is upstream-owned | reshape 4 | not changed | **open** (idea: fork-owned home file) |
| `LocalPicture` is internal but is the only way to show a local picture in a slot | reshape | not changed | **open**, contract gap |
| No small-caps utility, no fork stylesheet | reshape 1 | not changed | **open** |
| Sale badge, Bestsellers, brand pictures need API data | reshape 1, 4 | outside this plan (WP6) | **open** |
| Menu panel width at 320 px with long category names | found in PR 249 review | not changed | **open**, pre-existing |
| Card kind chosen by name needs `config/catalog.ts` | reshape 1, 2 | not changed | **open** |

Expected effect after PR 252 and 253 for a rebrand: core edits drop from 5 to 2 (`email-theme.ts`, `theme-color.ts`), undocumented test edits to 0. Prescribed test work remains: an in-place edit of `brand.spec.ts` and the deletion of the fork-deletable specs (`header-footer-defaults.upstream.spec.tsx` with its folder, `brand-overrides.upstream.spec.ts`, `fork-marker.upstream.spec.ts`, and for card overrides `cards/custom.upstream.spec.ts`); by the strict 7.4 classifier these still count, so "0 core edits, no test edits" holds only under this document's convention (section intro). For the
reshape: 4 of 5 requests by config plus new files without spec edits (R1, R2, R4, R5), R3 stays a core edit. These are expectations from the
closed gaps, not measurements.

## 5. Open items after A1

1. Re-run both scenarios on `main` (two models each, the worse counts), including the three-upstream-edits conflict test (protocol 7.4 step 4)
   and the browser check of the centred header and hero overlay. Update this file with the measured numbers.
2. Owner decisions: `EmailTheme` display font and accent (public interface change); whether `home.ts` becomes fork-owned; whether
   `AGENTS.md` mentions `.fluxkit-fork` and links `docs/customization.md` (the file is the owner's); acknowledgement that the `full` home width
   applies to custom sections only (plan section 9).
3. Unverified in A1: e2e (no Postgres in the agents' sandbox) and Chromium rendering. CI runs both on `main`; the visual job compared computed
   styles and screenshots for every merged PR, but not the agents' A1 branches.
4. Agent attribution: commits of this work carry a "Co-Authored-By: Claude Opus 5.5" line; history was not rewritten.
