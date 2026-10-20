import type { AdminOperationName } from "@fluxkit/api-client";
import { canRun } from "../../permissions";

/**
 * Every write the dictionary screens can make, by the API operation. A write control is rendered only when the signed-in
 * admin may run ALL of them (they are one permission today, `catalog.write`; naming the operations keeps the screens
 * following `ADMIN_OPERATIONS` if the API splits them). The API decides anyway: a 403 is shown and the permissions are read again.
 */
export const DICTIONARY_WRITE_OPERATIONS = [
  "createAttribute",
  "updateAttribute",
  "deleteAttribute",
  "createAttributeOption",
  "updateAttributeOption",
  "deleteAttributeOption",
  "createOption",
  "updateOption",
  "deleteOption",
  "createOptionValue",
  "updateOptionValue",
  "deleteOptionValue",
  "createProductType",
  "updateProductType",
  "deleteProductType",
  "putProductTypeAttribute",
  "removeProductTypeAttribute",
  "putProductTypeOption",
  "removeProductTypeOption",
  "createBrand",
  "updateBrand",
  "deleteBrand",
  "createCategory",
  "updateCategory",
  "deleteCategory",
  "moveCategory",
] as const satisfies readonly AdminOperationName[];

export function canWriteDictionaries(permissions: readonly string[] | null): boolean {
  return DICTIONARY_WRITE_OPERATIONS.every((operation) => canRun(permissions, operation));
}
