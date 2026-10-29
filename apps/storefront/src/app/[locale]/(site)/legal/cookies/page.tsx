import { legalPageMetadata, legalPageRoute } from "../../../../../lib/legal-route";

export const generateMetadata = legalPageMetadata("cookies");

/** `/{locale}/legal/cookies`: the cookie statement (the cookies a shopper can receive; no consent banner). */
export default legalPageRoute("cookies");
