import type { LazyFile } from "../../messages";
import { UserCreatePage } from "./user-create-page";
import { UserDetailPage } from "./user-detail-page";
import { UserListPage } from "./user-list-page";

/** The admin users area (plan step 10, owner only) loads its own messages only (`users`). */
export const MESSAGE_FILES: readonly LazyFile[] = ["users"];

/** `/users`: the list of admin users. */
export const UsersPage = UserListPage;
/** `/users/new`: create an admin user. */
export const UserNewPage = UserCreatePage;
/** `/users/:id`: one user with role, activity and password reset. */
export { UserDetailPage };
