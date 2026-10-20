# apps/admin (React + Vite SPA under `/admin-ui/`)

Run, headers and conventions: `apps/admin/README.md`. Plan: `docs/plans/2026-10-19-admin-ui.md`; ADR 0027.

## Root
- `index.html` - SPA document (`lang`, `noindex`, `no-referrer`); no inline script (strict CSP).
- `vite.config.ts` - base `/admin-ui/`, build manifest, dev and preview proxy of `/admin` to `ADMIN_DEV_API_URL` (dev only). Must not proxy `/admin-ui`.
- `vitest.config.ts` - Vitest in node: `src/**/*.spec.ts(x)` and the root specs.
- `security-headers.ts` - the header set for `/admin-ui/*` (CSP, framing, referrer, cache); plain TS so proxies can import it.
- `security-headers.spec.ts`, `vite-config.spec.ts` - pin the headers, the base path and the proxy rule.
- `build-output.spec.ts` - checks of the built `dist/`: no inline script or external URL, assets under the base path, lazy area chunks, initial JS budget, no zod, storage use. Needs `vite build` first.

## src
- `main.tsx` - creates the data router (`basename` `/admin-ui`) and renders providers; nothing else.
- `routes.ts` - the route table: path, API operation, permission (from `ADMIN_OPERATIONS`), title key, eager or lazy page. Must not import layout code (cycles).
- `permissions.ts` - `permissionOf`, `canAccess`, `canRun`: read only `me.permissions`, never the role.
- `source-guards.spec.ts` - no hardcoded text (TypeScript AST), no raw HTML, forms post without action, storage, fetch, title, navigation and import rules.
- `test-helpers.ts` - sentinel translator and render helpers for specs only.
- `router/` - `base-path.ts` (base path, API prefix rule), `paths.ts` (route paths, `buildPath`, `browserPath`), `safe-next.ts` (sign-in `next`), `query.ts` (list filter and paging codec), `navigation-focus.ts` (focus after navigation), `unsaved-changes.ts` and `unsaved-changes-dialog.tsx` (leave guard), `route-objects.tsx` (route table to react-router objects, not-found route, error boundaries).
- `session/` - `session-model.ts` (pure session states and transitions), `session-context.tsx` (`SessionProvider`: `me`, sign-in, sign-out, 401/403 signals, redirects), `reauth-dialog.tsx` (re-sign-in over the page).
- `lib/` - `diff-for-patch.ts` (PATCH bodies from changed fields only; generic), `run-write.ts` (one write, once; outcome `ok`, `problem`, `unknown`), `use-crash.ts` (hands a bug to the error boundary), `use-refreshing-resource.ts` and `refreshing-view.ts` (`useResource` that keeps the last data while a reload runs), `api.ts` (the one admin client), `request-timeout.ts`, `session-signals.ts` (401/403 of every response), `use-resource.ts` (read hook, abort, no retry), `failure.ts`, `problem-messages.ts` (code map), `form-errors.ts`, `format.ts` (money, dates), `safe-http-url.ts`, `retry-after.ts`. No React components except the hook; no `@fluxkit/core` import.
- `i18n/` - `locale-preference.ts` (browser language, stored choice), `i18n-context.tsx` (translator, `<html lang>`, the only `localStorage` access), `use-document-title.ts` (the only `document.title` writer).
- `messages/` - `{uk,en}/<area>.json` (account, auth, common, errors, navigation, shell, status), `index.ts` (merge, duplicate check), `messages.spec.ts` (parity, placeholders, plurals, used keys).
- `layout/` - `shell.tsx` (frame, permission gate, title, focus, re-sign-in dialog), `protected-layout.tsx` (session gate), `navigation.ts` (navigation groups as configuration), `language-switch.tsx`, `user-menu.tsx`. Layout only; no data fetching except the session.
- `views/` - `status-views.tsx` (page heading, not found, not allowed, not built, error, loading, failure message, `ResourceFallback`), `error-boundaries.tsx` (route, root and app boundaries).
- `areas/` - `auth/` (sign-in page and form), `account/` (own account, password change), `home/` (start page), `catalog-dictionaries/` (step 5, below), and one lazy module per area still to be built: `products/`, `orders/`, `customers/`, `users/` (placeholders).
- `styles.css` - Tailwind, design tokens and the token mapping; scans `packages/ui/src`.

## src/areas/catalog-dictionaries (plan step 5; one lazy chunk, five screens)
- `index.tsx` - the exports the route table names (`AttributesPage`, `AttributeNewPage`, `AttributeDetailPage`, and the same for options, product types, brands, categories). Must stay the only module the route table imports.
- `attributes-page.tsx`, `options-page.tsx`, `product-types-page.tsx`, `brands-page.tsx`, `categories-page.tsx` - the data-bound pages of each dictionary: list (or tree), create, editor with its reload, status line, delete. They fetch and write; they hold no markup rules.
- `attribute-form.ts`, `dictionary-forms.ts` - the pure form models: values, early checks, create and PATCH bodies (flags, typed `validation`, locale maps, assignments, move). No React, no client.
- `locale-text.ts` - locale-map helpers (one string per locale, empty omitted, default locale required, display fallback, language names). `form-rules.ts` - patterns and limits copied from core (compared in tests), `parsePosition`, `FormIssues`.
- `category-tree.ts` - the tree model (state, expand and collapse, `toggleNode`, nested `treeItems`) and `collectRoots` (the roots workaround: pages the flat list, 10 pages at most, reports truncation). `picker-model.ts` - paging of a picker (100 a page, load more, offset limit).
- `submit-errors.ts` - problem answer to field errors and summary, `SubmitState` after an outcome, delete hint rule. `use-form-submit.ts` - the hook around them (busy, summary focus, never retries). `use-editor-state.ts` - status line, delete confirmation and "deleted" state of an editor.
- `attribute-form-view.tsx`, `code-name-form-view.tsx`, `brand-form-view.tsx`, `category-form-view.tsx`, `category-tree-view.tsx` - presentational forms and the tree (props in, markup out; read-only without write permission).
- `items-section.tsx` (rows of an attribute's options and an option's values), `product-type-assignments.tsx` (attribute and option assignments), `form-dialog.tsx` (modal form, confirmed delete), `server-picker.tsx` (paged server list in a select), `form-parts.tsx` (summary, locale fields, text field, actions), `dictionary-frame.tsx` (sub-navigation, page frame, status line, focused panels, danger zone), `list-screen.tsx` (list states and pager), `config-gate.tsx` (content locales from `GET /admin/config`).
- `dictionary-permissions.ts` - the write operations of the area (names from `ADMIN_OPERATIONS`) and `canWriteDictionaries`. Write controls must be gated by it.
- Specs: one per pure module, `screens.spec.tsx` (static markup of every state, read-only vs editable, the real uk and en messages), `dictionary-messages.spec.ts` (keys built from data).
- `messages/{uk,en}/catalog-dictionaries.json` - the area's strings (`dict.*`, titles of the new routes).
