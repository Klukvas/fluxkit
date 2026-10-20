import { useCallback, useState } from "react";

/**
 * Lets an event handler or an effect hand a bug (not a failed request) to the route's error boundary: the error is stored
 * and thrown during the next render, because an error thrown inside a promise or an event handler never reaches a boundary
 * by itself. Use it where `failureFromError` rethrew.
 */
export function useCrash(): (error: unknown) => void {
  const [crash, setCrash] = useState<{ error: unknown } | null>(null);
  if (crash !== null) throw crash.error;
  return useCallback((error: unknown) => setCrash({ error }), []);
}
