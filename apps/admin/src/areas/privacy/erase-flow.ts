import { confirmationMatches } from "./privacy-view";

/**
 * The gate in front of the erase call (privacy UI review F5): the dialog's typed word is checked before anything is built or
 * sent, so a dialog without the word never reaches the API. A pure function so the direction of the check is unit tested; the
 * page wires the state around it.
 */
export type EraseAttempt<Outcome> =
  { kind: "word_mismatch" } | { kind: "no_body" } | { kind: "sent"; outcome: Outcome };

export async function attemptErase<Body, Outcome>(input: {
  typed: string;
  /** The word shown in the dialog, translated. */
  expectedWord: string;
  /** The request body, or `null` after the page showed why there is none (for example a bad address). */
  buildBody: () => Body | null;
  send: (body: Body) => Promise<Outcome>;
}): Promise<EraseAttempt<Outcome>> {
  if (!confirmationMatches(input.typed, input.expectedWord)) return { kind: "word_mismatch" };
  const body = input.buildBody();
  if (body === null) return { kind: "no_body" };
  return { kind: "sent", outcome: await input.send(body) };
}
