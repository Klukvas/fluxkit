/**
 * The shop pages (`config/shop-pages.ts`) share the locale check of `(site)` but live in their own route group on purpose, like
 * `(catalog)`: `(site)/loading.tsx` streams the shell first, which would make the HTTP status 200 even when the page then calls
 * `notFound()`. An unknown or switched-off page must answer a real 404 (`route-structure.spec.ts`).
 */
export { default } from "../(site)/layout";
