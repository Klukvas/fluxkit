"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The SKU text of the variant the product page's island has selected, for the specifications (review D-08: the SKU left the
 * buy column). The island passes the SKU, or its "none" mark while no variant matches; outside the island it is empty.
 */
const SelectedSkuContext = createContext<string>("");

export function SelectedSkuProvider({ text, children }: { text: string; children: ReactNode }) {
  return <SelectedSkuContext.Provider value={text}>{children}</SelectedSkuContext.Provider>;
}

/** A client leaf inside the server-rendered specifications. */
export function SelectedSku() {
  return <>{useContext(SelectedSkuContext)}</>;
}
