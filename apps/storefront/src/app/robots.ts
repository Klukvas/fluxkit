import { locales } from "@fluxkit/ui";
import type { MetadataRoute } from "next";
import { publicOrigin } from "../lib/public-url.server";
import { buildRobots } from "../lib/robots";

/** `/robots.txt`: needs the public origin for the sitemap line, so it is read per request, never at build. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  return buildRobots({ origin: await publicOrigin(), locales });
}
