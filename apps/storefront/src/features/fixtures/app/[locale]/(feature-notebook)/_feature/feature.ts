/**
 * TEST FIXTURE of a feature slice (not routed: it lives outside `src/app`). The specs of the slice mechanism run the registry
 * generator, the registry checks, the message merge, the header, footer and sitemap hooks and the route rules on it. A real
 * slice's manifest is `src/app/[locale]/(feature-<name>)/_feature/feature.ts` and looks the same.
 */
import type { StorefrontFeature } from "../../../../../types";
import en from "./messages/en.json";
import uk from "./messages/uk.json";

export const feature: StorefrontFeature = {
  name: "notebook",
  navigation: [
    { placement: "header", labelKey: "features.notebook.nav", path: "/notebook" },
    { placement: "footer", labelKey: "features.notebook.nav", path: "/notebook" },
  ],
  sitemap: async () => [{ path: "/notebook" }],
  messages: { uk, en },
};
