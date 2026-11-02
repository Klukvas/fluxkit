import { themeConfig } from "../../config/theme";
import { publicOrigin } from "../../lib/public-url.server";
import { themeFormResponse } from "../../lib/theme-route";

/** `POST /theme`: the theme switch without a script (`lib/theme-route.ts`). */
export async function POST(request: Request): Promise<Response> {
  return themeFormResponse(request, {
    enabled: themeConfig.showToggle,
    secure: async () => (await publicOrigin()).startsWith("https:"),
  });
}
