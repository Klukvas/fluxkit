import { parseThemeMode, safeThemeReturnPath, themeCookie } from "./theme-mode";

/**
 * The answer of `POST /theme` (`app/theme/route.ts`): the footer's theme switch without a script
 * (`components/theme-switch.tsx`; with a script it applies the choice in the browser and never posts). Stores the choice in
 * the `fluxkit_theme` cookie and sends the shopper back to the page they were on (`303`, a checked path of this storefront
 * only). Anything but the form's own values is refused with `400`; with the switch hidden in `config/theme.ts` the route
 * does not exist (`404`).
 */
export async function themeFormResponse(
  request: Request,
  options: {
    /** `showToggle` of `config/theme.ts`. */
    enabled: boolean;
    /** Whether the shop is served over https (the cookie then gets `Secure`). */
    secure: () => Promise<boolean>;
  },
): Promise<Response> {
  if (!options.enabled) {
    return new Response(null, { status: 404 });
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

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
