import type { NextFunction, Request, Response } from "express";
import { markAdminResponseUncacheable } from "../common/admin-path.js";

/** Sets `Cache-Control: no-store` before the request reaches any guard or handler, so success and error alike carry it. */
export function adminNoStoreMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  markAdminResponseUncacheable(request, response);
  next();
}
