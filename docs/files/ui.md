# packages/ui

- `src/button.tsx`, `src/card.tsx`, `src/container.tsx` - token-styled primitives (semantic Tailwind classes only).
- `src/cn.ts` - class name joiner.
- `src/i18n.ts` - `locales`, `defaultLocale`, `isLocale`, `createTranslator` (a missing key throws).
- `src/index.ts` - public entry point; other packages import only from here.
- Built with `tsc` to `dist/` (bundler resolution, consumed by Next and Vite).
