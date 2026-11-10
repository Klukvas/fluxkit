import type { ProductCardSlotProps } from "../lib/slots";
import { FavouriteButton } from "./favourite-button";

/** FORK slot component (`product-card.actions`): the favourite heart, with an accessible name that includes the title. */
export function FavouriteAction({ card, t }: ProductCardSlotProps) {
  return <FavouriteButton label={t("custom.card.favourite", { title: card.title })} />;
}
