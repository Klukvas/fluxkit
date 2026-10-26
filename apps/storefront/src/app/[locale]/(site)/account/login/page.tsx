import { Container, createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { LoginForm } from "../../../../../components/login-form";
import { getEmailDelivery } from "../../../../../lib/catalog-pages.server";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface LoginRouteProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: LoginRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(createTranslator(messagesByLocale[locale], locale), "account.login.title");
}

/**
 * Shell only. `next` (where to go afterwards) is passed on as it came; the form checks it with `safeNextPath` before it
 * navigates or links anywhere, so a value from the URL can never leave the storefront.
 */
export default async function LoginRoute({ params, searchParams }: LoginRouteProps) {
  await routeLocale(params);
  const { next } = await searchParams;
  return (
    <Container className="py-8">
      <div className="max-w-md">
        <LoginForm
          next={typeof next === "string" ? next : undefined}
          emailDelivery={await getEmailDelivery()}
        />
      </div>
    </Container>
  );
}
