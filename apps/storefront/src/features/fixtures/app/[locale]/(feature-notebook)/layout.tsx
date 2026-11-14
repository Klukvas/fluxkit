/**
 * TEST FIXTURE (see `_feature/feature.ts`). A real slice's layout is `export { default } from "../(site)/layout";`: the locale
 * check of `(site)` without its home `loading.tsx`, like `(catalog)` and `(pages)`, so a page can still answer a real 404.
 */
export { default } from "../../../../../app/[locale]/(site)/layout";
