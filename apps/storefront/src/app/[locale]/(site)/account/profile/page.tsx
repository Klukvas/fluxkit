import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { ProfilePage } from "../../../../../components/profile-forms";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface ProfileRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ProfileRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(
    createTranslator(messagesByLocale[locale], locale),
    "account.profile.heading",
  );
}

export default async function ProfileRoute({ params }: ProfileRouteProps) {
  await routeLocale(params);
  return <ProfilePage />;
}
