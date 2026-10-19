import { Badge, type BadgeVariant } from "./badge";

export type StatusTone = BadgeVariant;

export interface StatusBadgeProps {
  tone: StatusTone;
  /** The status as visible text: the tone alone never carries the meaning. */
  label: string;
}

/** A status (order, product, user) as text with a tone. */
export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return <Badge variant={tone}>{label}</Badge>;
}
