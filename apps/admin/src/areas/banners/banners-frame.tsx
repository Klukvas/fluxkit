import type { ReactNode } from "react";
import { PageHeading } from "../../views/status-views";

/** Every banner screen: the one `h1`, an optional action beside it, then the content. */
export function BannersFrame({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{title}</PageHeading>
        {actions}
      </div>
      {children}
    </div>
  );
}
