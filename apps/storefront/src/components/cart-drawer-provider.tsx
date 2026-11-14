"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface CartDrawerContextValue {
  isOpen: boolean;
  opener: HTMLElement | null;
  open(opener?: HTMLElement | null): void;
  close(): void;
}
const CartDrawerContext = createContext<CartDrawerContextValue | null>(null);

/** The shell owns one drawer; opening never starts another cart store or another cart read. */
export function CartDrawerProvider({
  children,
  drawer,
}: {
  children: ReactNode;
  drawer?: ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const open = useCallback((element?: HTMLElement | null) => {
    setOpener(
      element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    );
    setHasOpened(true);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ isOpen, opener, open, close }), [isOpen, opener, open, close]);
  return (
    <CartDrawerContext.Provider value={value}>
      {children}
      {hasOpened ? drawer : null}
    </CartDrawerContext.Provider>
  );
}

export function useCartDrawer(): CartDrawerContextValue {
  const value = useContext(CartDrawerContext);
  if (value === null) throw new Error("useCartDrawer needs a CartDrawerProvider above it.");
  return value;
}
