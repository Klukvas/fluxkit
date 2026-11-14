"use client";

import { appendToast, Toast, ToastStack, type ToastTone } from "@fluxkit/ui";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "./i18n-provider";

/** Reading time, independent of animation duration and reduced-motion preferences. */
export const TOAST_LIFETIME_MS = 8000;
interface ToastInput {
  tone: ToastTone;
  message: string;
  action?: ReactNode;
}
interface ToastEntry extends ToastInput {
  id: number;
}
interface Toaster {
  push(toast: ToastInput): number;
  dismiss(id: number): void;
}
const ToastContext = createContext<Toaster | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const sequence = useRef(0);
  const dismiss = useCallback(
    (id: number) => setToasts((items) => items.filter((item) => item.id !== id)),
    [],
  );
  const push = useCallback((toast: ToastInput) => {
    const id = ++sequence.current;
    setToasts((items) => appendToast(items, { ...toast, id }));
    return id;
  }, []);
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            lifetime={TOAST_LIFETIME_MS}
            dismissLabel={t("cart.toast.dismiss")}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </ToastStack>
    </ToastContext.Provider>
  );
}
export function useToasts(): Toaster {
  const value = useContext(ToastContext);
  if (value === null) throw new Error("useToasts needs a ToastProvider above it.");
  return value;
}
