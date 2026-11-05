import { parseThemeMode, safeThemeReturnPath, themeCookie } from "./theme-mode";

/**
 * The answer of `POST /theme` (`app/theme/route.ts`): the footer's theme switch without a script
 * (`components/theme-switch.tsx`; with a script it applies the choice in the browser and never posts). Stores the choice in
 * the `fluxkit_theme` cookie and sends the shopper back to the page they were on (`303`, a checked path of this storefront
 * only). A form posted from another site or origin is refused with `403` (`isCrossOrigin`); anything but the form's own
 * values with `400`; with the switch hidden in `config/theme.ts` the route does not exist (`404`).
 */
export async function themeFormResponse(
  request: Request,
  options: {
    /** `showToggle` of `config/theme.ts`. */
    enabled: boolean;
    /** Whether the shop is served over https (the cookie then gets `Secure`). */
    secure: () => Promise<boolean>;
    /** The storefront's public origin (`STOREFRONT_PUBLIC_URL`), the only `Origin` a form may be posted from. */
    publicOrigin: () => Promise<string>;
  },
): Promise<Response> {
  if (!options.enabled) {
    return new Response(null, { status: 404 });
  }
  if (isCrossOrigin(request, await options.publicOrigin())) {
    return new Response(null, { status: 403 });
  }
  const type = request.headers.get("content-type") ?? "";
  if (
    !type.startsWith("application/x-www-form-urlencoded") &&
    !type.startsWith("multipart/form-data")
  ) {
    return plain(400, "Expected a form.");
  }
  const form = await request.formData();
  const value = form.get("mode");
  const mode = parseThemeMode(typeof value === "string" ? value : null);
  if (mode === null) {
    return plain(400, "Unknown theme.");
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: safeThemeReturnPath(form.get("return")),
      "Set-Cookie": themeCookie(mode, { secure: await options.secure() }),
      "Cache-Control": "no-store",
    },
  });
}

/**
 * A form another site makes the browser post (review m1 of design batch B): `Sec-Fetch-Site` says so, or `Origin` names
 * another origin (`null` included). A sibling host (`same-site`) is another origin too. A request with neither header (an
 * old browser, curl) passes: it cannot be told apart, and the worst it does is set a theme.
 */
function isCrossOrigin(request: Request, publicOrigin: string): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") {
    return true;
  }
  const origin = request.headers.get("origin");
  return origin !== null && origin !== publicOrigin;
}

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
