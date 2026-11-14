import type { ReactNode } from "react";
import { PageHeader } from "../../views/status-views";

/** Every banner screen: the one `h1`, an optional action beside it, then the content. */
export function BannersFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </div>
  );
}
