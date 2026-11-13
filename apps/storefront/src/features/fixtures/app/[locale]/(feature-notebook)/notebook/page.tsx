import { createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFeature } from "../../../../../runtime.server";
import { feature } from "../_feature/feature";

interface NotebookPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * TEST FIXTURE (see `_feature/feature.ts`): the shape every page of a slice keeps. `requireFeature` is the first statement of
 * the page and of `generateMetadata`, before any read of the feature's API: a real 404 while the feature is off.
 */
async function translatorOf({ params }: NotebookPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return createTranslator(feature.messages[locale], locale);
}

export async function generateMetadata(props: NotebookPageProps): Promise<Metadata> {
  await requireFeature("notebook");
  const t = await translatorOf(props);
  return { title: t("features.notebook.title") };
}

export default async function NotebookPage(props: NotebookPageProps) {
  await requireFeature("notebook");
  const t = await translatorOf(props);
  return <h1>{t("features.notebook.title")}</h1>;
}
