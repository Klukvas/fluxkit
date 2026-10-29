import { legalPageMetadata, legalPageRoute } from "../../../../../lib/legal-route";

export const generateMetadata = legalPageMetadata("terms");

/** `/{locale}/legal/terms`: placeholder terms (`config/legal.ts`; the shop supplies its own text). */
export default legalPageRoute("terms");
