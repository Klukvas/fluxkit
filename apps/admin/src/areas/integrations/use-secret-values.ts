import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where a typed secret may live (plan `2026-11-16-admin-integrations`, section 8 "Secret lifecycle"): in the state of
 * the open dialog and nowhere else. This hook is that state. It hands the values out once (`take`, for the one request)
 * and wipes them when they must not outlive the moment: on submit, on close, when the session ends or another admin
 * signs in, when the dialog unmounts, when the page is hidden for good or frozen (`pagehide`), and when the browser brings
 * the page back from its Back/Forward cache (`pageshow` with `persisted`), which would otherwise restore the typed text.
 */

/** The part of `window` the hook listens to, so the rule runs without a DOM in tests. */
export interface PageLifecycleTarget {
  addEventListener(
    type: "pagehide" | "pageshow",
    listener: (event: PageLifecycleEvent) => void,
  ): void;
  removeEventListener(
    type: "pagehide" | "pageshow",
    listener: (event: PageLifecycleEvent) => void,
  ): void;
}
export interface PageLifecycleEvent {
  persisted?: boolean;
}

/** Calls `wipe` on every `pagehide` and on a `pageshow` out of the Back/Forward cache. Answers the function that stops. */
export function watchPageLifecycle(wipe: () => void, target: PageLifecycleTarget): () => void {
  const onHide = () => wipe();
  const onShow = (event: PageLifecycleEvent) => {
    if (event.persisted === true) wipe();
  };
  target.addEventListener("pagehide", onHide);
  target.addEventListener("pageshow", onShow);
  return () => {
    target.removeEventListener("pagehide", onHide);
    target.removeEventListener("pageshow", onShow);
  };
}

/**
 * Who may hold the typed secret: the id of the signed-in admin, or `null` as soon as the session is anything but signed
 * in (expired under the re-sign-in dialog, signed out, still loading).
 */
export function secretHolder(session: {
  status: string;
  me: { user: { id: string } } | null;
}): string | null {
  return session.status === "signedIn" ? (session.me?.user.id ?? null) : null;
}

export interface SecretValues<Values> {
  values: Values;
  set: (next: Values) => void;
  /** The values for the one request that sends them; the state is empty from this call on, whatever the answer. */
  take: () => Values;
  wipe: () => void;
}

/**
 * @param blank the empty values (read once; later arguments are ignored)
 * @param holder `secretHolder` of the session; a change wipes the values and calls `onRevoked`
 * @param onRevoked closes the dialog: the values are gone and the reason they were typed no longer holds
 */
export function useSecretValues<Values>(
  blank: Values,
  holder: string | null,
  onRevoked: () => void,
  target: PageLifecycleTarget = window,
): SecretValues<Values> {
  const [empty] = useState(blank);
  const [values, setValues] = useState(empty);
  const [firstHolder] = useState(holder);
  const onRevokedRef = useRef(onRevoked);
  useEffect(() => {
    onRevokedRef.current = onRevoked;
  });

  const wipe = useCallback(() => setValues(empty), [empty]);

  useEffect(() => {
    const stop = watchPageLifecycle(() => {
      wipe();
      onRevokedRef.current();
    }, target);
    return () => {
      stop();
      wipe();
    };
  }, [wipe, target]);

  const isRevoked = holder !== firstHolder;
  useEffect(() => {
    if (!isRevoked) return;
    wipe();
    onRevokedRef.current();
  }, [isRevoked, wipe]);

  return {
    // Not even one render shows the values to another holder: the effect above wipes the state right after.
    values: isRevoked ? empty : values,
    set: setValues,
    take: () => {
      setValues(empty);
      return isRevoked ? empty : values;
    },
    wipe,
  };
}
