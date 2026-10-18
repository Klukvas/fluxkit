import type { MetadataRoute } from "next";
import { loadSitemap } from "../lib/sitemap.server";

/** `/sitemap.xml`: rendered per request (the build has no API); the API reads behind it are cached for an hour. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return loadSitemap();
}
