import { applyDecorators, Controller } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiProblemResponses } from "../../common/openapi.js";

/**
 * Use instead of `@Controller` for every public store resource: `@StoreController("products")` serves
 * `/store/products`. Deliberately has NO guard: the store API is public and read-only (GET only).
 */
export function StoreController(resource: string): ClassDecorator {
  return applyDecorators(
    Controller(`store/${resource}`),
    ApiTags("store"),
    ApiProblemResponses(400, 500),
  );
}
