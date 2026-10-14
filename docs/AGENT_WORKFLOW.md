# Agent workflow: roles, models, effort

Recommendation, to be tuned after the first sprints. Model names are current family names; swap as new ones ship.

## Roles

| Role | Model | Effort | When | Output |
|---|---|---|---|---|
| Architect | Fable 5.1 | high / max | New module, data model change, ADR, tricky trade-offs, big refactor | ADR, schema design, module contract |
| Orchestrator | Opus 5.5 | high | Every feature/epic: plan, task split, integration, DoD check | `docs/plans/*.md`, task list, final report |
| Developer (default) | Sonnet 5.5 | medium | Scoped feature/fix inside an approved plan | Code + tests + docs |
| Developer (critical paths) | Sonnet 5.5 or Opus 5.5 | high | Checkout, payments, pricing, stock, auth, migrations | Code + tests + docs |
| Developer (parallel, isolated tasks) | Codex | per task | Independent modules/paths, boilerplate, UI components | Code + tests |
| QA / Reviewer | Opus 5.5 (or Codex as cross-reviewer) | high | Every PR; always a different agent than the author | Review findings, test gaps |
| Test writer | Sonnet 5.5 | medium | Unit/integration/e2e for finished code | Tests |
| Docs / chores | Haiku 5.5 | low | API/file docs sync, changelog, formatting, seeds | Doc updates |

## Flow

```
User goal
  -> Orchestrator: analyze existing code/docs, write plan
       -> (if data model / boundaries affected) Architect: ADR + contract
  -> Orchestrator: split into tasks with owned paths
  -> Developers (parallel where paths do not overlap)
  -> Docs/chores sync docs
  -> QA/Reviewer (different agent): review + tests
  -> Orchestrator: verify DoD, report to user
```

## Rules of thumb

- Spend effort where mistakes are expensive: money, data model, auth, migrations. Use lower effort for mechanical work.
- Author never reviews own change. Cross-model review catches different mistakes.
- Escalate on blockers instead of guessing: Developer -> Orchestrator -> Architect -> user.
- Keep tasks small enough that a Developer finishes in one session with a clear verification command.
- Every handoff is a file or a written task, not an assumption.

## Decisions log (workflow)

- Tests: TDD for money logic, tests-with-code elsewhere.
- Autonomy: stop-and-ask list (red zones), see AGENTS.md section 14.
- Cleanliness: clean master repo, client work in forks.
- Dependencies: license allowlist + CI audit + pinned versions.
- Feature removal: verified by CI build matrix.
- Contracts: SemVer + `docs/contracts/` registry.
- Stack: decided, see ADR 0002.
- Stack inputs gathered: team knows Python + JS/TS; first market is Ukraine (UAH, uk/en, Ukrainian payments/shipping), then EU and US; core engine (ready-made vs own) and admin approach still open, to be discussed in chat.
- Core: own core (ADR 0001). Stack: TypeScript, NestJS, REST+OpenAPI, Postgres+Drizzle, Meilisearch, Redis+BullMQ, Next.js+Tailwind storefront, React SPA admin, Docker Compose (ADR 0002).
- Tooling: pnpm + Turborepo, Vitest + Playwright, ESLint + Prettier + dependency-cruiser, GitHub + Actions (ADR 0003).
- Data model: JSONB attributes, price table, inventory_level+reservations+movements, cart->order snapshot with separate payment/fulfillment (ADR 0004).
- Taxes: prices as entered + prices_include_tax setting, rates in tax_class. Pricing pipeline with adjusters in core, discounts/coupons as feature. customer_group in core, B2B pricing paid module (ADR 0004).
- Licenses: Redis 8 (AGPLv3, external service), dev-tooling licenses (MPL-2.0, Python-2.0, BlueOak-1.0.0, Apache-2.0 AND MIT), LGPL sharp-libvips and CC-BY caniuse-lite for specific cases, Python-2.0 for runtime `argparse` (AGENTS.md section 16).
- TypeScript pinned to 6.0.3 until typescript-eslint and dependency-cruiser support 7 (ADR 0003).
- CI: GitHub Actions with feature matrix, license/audit/docs checks (AGENTS.md section 18); scaffold plan completed (see its Outcome section).

## Practice that worked during the scaffold
- Every PR with code got an independent review by a different agent (PR #2 review found a cached-test false pass, a half-reverting down migration and a destructive test; all confirmed and fixed).
- Negative checks: each new guard (lint, boundaries, design guard, license policy, docs check, test env) was shown to fail on a deliberate violation before being trusted.
- First CI run on GitHub is part of the work: it found problems that cannot be seen in the agent container (no Docker daemon).
