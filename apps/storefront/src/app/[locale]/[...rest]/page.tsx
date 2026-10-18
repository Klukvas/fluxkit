import { notFound } from "next/navigation";

/**
 * Any path under a locale that no route handles. It lives outside `(site)` so it answers a real 404 status (the locale
 * check and `loading.tsx` of `(site)` would otherwise run first) and renders `not-found.tsx` inside the shell.
 */
export default function UnknownPath(): never {
  notFound();
}
