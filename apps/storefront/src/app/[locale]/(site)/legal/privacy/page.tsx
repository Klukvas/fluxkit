import { legalPageMetadata, legalPageRoute } from "../../../../../lib/legal-route";

export const generateMetadata = legalPageMetadata("privacy");

/** `/{locale}/legal/privacy`: placeholder privacy notice (`config/legal.ts`; the shop supplies its own text). */
export default legalPageRoute("privacy");
