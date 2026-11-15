"use client";

import { useSearchParams } from "next/navigation";
import { LoginForm } from "./login-form";

/**
 * The login form inside the sign-in modal, with `next` read from the address the browser shows. The intercepted slot can be
 * served from the client router cache of the same path without the query (a prefetched or earlier visit), so the server's
 * `searchParams` are not reliable here. Like the full page, only a single `next` value is passed on; the form checks it.
 */
export function SignInModalForm({ emailDelivery }: { emailDelivery: boolean }) {
  const values = useSearchParams().getAll("next");
  return <LoginForm next={values.length === 1 ? values[0] : undefined} emailDelivery={emailDelivery} />;
}
