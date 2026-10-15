import type { AdminUserRow } from "../admin-user.repository.js";
import { toAuthUser } from "../admin-user.mapper.js";
import type { UserResponse } from "./users.schemas.js";

/** Database row -> API shape. An allow list (see `toAuthUser`): the password hash can never be added by accident. */
export function toUserResponse(row: AdminUserRow): UserResponse {
  return {
    ...toAuthUser(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
