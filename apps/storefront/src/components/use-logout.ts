"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserCheckoutDraftStorage, clearCheckoutDraft } from "../lib/checkout-draft";
import type { Failure } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import { useI18n } from "./i18n-provider";
import { useAccount } from "./session-provider";

/**
 * Sign out through the shared account store, then go to the home page. Used by the account overview and the header's
 * account menu, so both behave the same: one request at a time, a failure kept for the caller to show, a bug rethrown.
 */
export function useLogout() {
  const { locale } = useI18n();
  const { store } = useAccount();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  /** Resolves `true` after a successful sign-out (the caller may close its menu), `false` otherwise. */
  async function logout(): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setFailure(null);
    try {
      const outcome = await store.logout();
      if (outcome.status === "failed") {
        setFailure(outcome.failure);
        setPending(false);
        return false;
      }
      // The checkout draft of this tab holds the signed-out customer's contact and address (review SQ-05).
      clearCheckoutDraft(browserCheckoutDraftStorage());
      router.replace(localizedHref(locale, "/"));
      return true;
    } catch (error) {
      setPending(false);
      throw error;
    }
  }

  return { pending, failure, logout };
}
