import type { StoreClient } from "@fluxkit/api-client";
import { clientFailure, failureFromThrown, type FieldFailure, type Failure } from "./failure";
import { confirmationMatches, deleteBody, mapDeleteFailure, type WaitParts } from "./personal-data";

/**
 * The deletion flow of the "Your data" page without React (privacy UI review F3 and F5): checks the typed word, sends the one
 * request and decides what the page does with every answer. The component only wires the effects to its state, so the rules
 * below are unit tested.
 */

export interface AccountDeletionEffects {
  /** The `erasure_blocked` reasons to list, or `null` to clear the list. */
  setBlocked(reasons: string[] | null): void;
  /** A rate-limit wait (`null`: limited without a usable wait), or `undefined` to clear it. */
  setLimited(wait: WaitParts | null | undefined): void;
  /** Empties the password field only (the typed word stays, so a retry needs the password again, nothing else). */
  clearPassword(): void;
  /** Empties the password and the typed word. */
  clearAll(): void;
  /** The API said the session ended: the account gate takes the shopper to the sign-in page. */
  sessionEnded(): void;
  /** Leaves for the confirmation page. */
  leave(): void;
}

export interface AccountDeletionInput {
  values: { password: string; confirmWord: string };
  /** The word the shopper must type, translated. */
  expectedWord: string;
  client: Pick<StoreClient, "deleteAccount">;
  effects: AccountDeletionEffects;
  /** The client call options (the page asks for `cache: "no-store"`). */
  callOptions: Parameters<StoreClient["deleteAccount"]>[1];
}

/**
 * Returns the failure to show, or `null` once the account is deleted. Nothing is sent unless the typed word matches. The
 * password is cleared after EVERY answer that is not a success and after a lost answer (the request may have reached the
 * API), so it never stays in the field or in React state while the shopper reads the message; a word that did not match
 * sent nothing, so there the password stays and only the word is corrected.
 */
export async function runAccountDeletion(input: AccountDeletionInput): Promise<Failure | null> {
  const { values, effects } = input;
  effects.setBlocked(null);
  effects.setLimited(undefined);
  // The typed word is the explicit confirmation: nothing is sent without it.
  if (!confirmationMatches(values.confirmWord, input.expectedWord)) {
    const mismatch: FieldFailure = {
      path: "confirmWord",
      code: "invalid",
      messageKey: "account.data.delete.wordMismatch",
    };
    return clientFailure("errors.validation_failed", [mismatch]);
  }
  let result;
  try {
    result = await input.client.deleteAccount(deleteBody(values.password), input.callOptions);
  } catch (error) {
    effects.clearPassword();
    return failureFromThrown(error);
  }
  if (result.ok) {
    // Both values leave the form's memory; the confirmation page reads the (now ended) session.
    effects.clearAll();
    effects.leave();
    return null;
  }
  effects.clearPassword();
  const mapped = mapDeleteFailure(result);
  switch (mapped.kind) {
    case "signed_out":
      effects.sessionEnded();
      return clientFailure("account.gate.redirecting");
    case "blocked":
      effects.setBlocked(mapped.reasons);
      return clientFailure("account.data.blocked.title");
    case "rate_limited":
      effects.setLimited(mapped.wait);
      return clientFailure("account.data.delete.limited");
    case "other":
      return mapped.failure;
  }
}
