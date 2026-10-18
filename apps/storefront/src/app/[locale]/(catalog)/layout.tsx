/**
 * The catalog, category and product routes share the locale check of `(site)` but live in their own route group on purpose:
 * `(site)/loading.tsx` streams the page shell first, which makes the HTTP status 200 even when the page then calls
 * `notFound()`. These routes must answer a real 404 for an unknown slug, a malformed page or an unknown category
 * (README, "Rendering"; `route-structure.spec.ts` fails if a `loading.tsx` ever sits above them).
 */
export { default } from "../(site)/layout";
