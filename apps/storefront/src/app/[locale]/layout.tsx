import { createTranslator, isLocale, locales } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { messagesByLocale } from "../../messages";
import "../globals.css";

interface LocaleParams {
  params: Promise<{ locale: string }>;
}

export function generateStaticParams(): { locale: string }[] {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  return { title: createTranslator(messagesByLocale[locale])("site.title") };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleParams & { children: ReactNode }) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  return (
    <html lang={locale} data-theme="light">
      <body>{children}</body>
    </html>
  );
}
