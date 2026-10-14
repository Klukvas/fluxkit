import type { Locale, Messages } from "@fluxkit/ui";
import en from "./en.json";
import uk from "./uk.json";

export const messagesByLocale: Record<Locale, Messages> = { uk, en };
