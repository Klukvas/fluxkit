import type { AdminPrincipal } from "../auth/admin-authenticator.js";

/** The authenticated actor and the address counted by strict limits; never persisted in credential metadata. */
export interface IntegrationActor {
  readonly principal: AdminPrincipal;
  readonly clientAddress: string;
}
