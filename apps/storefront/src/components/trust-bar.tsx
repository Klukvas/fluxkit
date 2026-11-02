import { TrustBar, type Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import { trustBarItems, type TrustBarIconKey, type TrustBarItemConfig } from "../config/trust-bar";
import { ChatIcon, DeliveryIcon, LockIcon, ReturnIcon } from "./icons";

const icons: Record<TrustBarIconKey, () => ReactNode> = {
  delivery: () => <DeliveryIcon />,
  payment: () => <LockIcon />,
  contact: () => <ChatIcon />,
  returns: () => <ReturnIcon />,
};

/**
 * The shop's trust bar from `config/trust-bar.ts` (no state, no request; server and client components both render it). Renders
 * nothing when the config lists no item. `items` exists for tests; pages use the config.
 */
export function StoreTrustBar({
  t,
  items = trustBarItems,
  className,
}: {
  t: Translator;
  items?: readonly TrustBarItemConfig[];
  className?: string;
}) {
  return (
    <TrustBar
      label={t("trust.label")}
      className={className}
      items={items.map((item) => ({
        key: item.messageKey,
        icon: icons[item.icon](),
        text: t(item.messageKey),
      }))}
    />
  );
}
