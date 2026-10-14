# apps/admin (React + Vite SPA)

- `index.html`, `vite.config.ts` - Vite entry and config (React and Tailwind plugins).
- `src/main.tsx`, `src/App.tsx` - bootstrap and placeholder screen built from `@fluxkit/ui`.
- `src/styles.css` - imports Tailwind, design tokens and the token mapping; scans `packages/ui/src`.
- `src/messages/` - `uk`/`en` strings and `detectLocale` (browser language, falls back to `uk`).
- Run: `pnpm --filter @fluxkit/admin dev` (needs `pnpm build` once so workspace packages are built).
