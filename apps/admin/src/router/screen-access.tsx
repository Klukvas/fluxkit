import { createContext, useContext } from "react";
import type { RouteId } from "./paths";

/**
 * What a page may ask about another screen without importing the route table (an area that imported `routes.ts` would
 * form an import cycle, because the route table loads the areas): whether the signed-in admin may open it, and the message
 * key of its title. The shell provides it from the route table and the session (`layout/shell.tsx`).
 */
export interface ScreenAccess {
  canOpen: (route: RouteId) => boolean;
  titleKey: (route: RouteId) => string;
}

const ScreenAccessContext = createContext<ScreenAccess | null>(null);

export const ScreenAccessProvider = ScreenAccessContext.Provider;

export function useScreenAccess(): ScreenAccess {
  const value = useContext(ScreenAccessContext);
  if (value === null) throw new Error("useScreenAccess must be used inside the shell.");
  return value;
}
