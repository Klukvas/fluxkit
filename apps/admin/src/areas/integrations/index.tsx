import type { LazyFile } from "../../messages";
import { IntegrationsPage } from "./integrations-page";

/**
 * The Integrations area (ADR 0058, slice 1; permission integrations.manage, owner only): the provider API keys the
 * owner pastes, stored encrypted by the API and explicitly activated for runtime use. Its texts are its own lazy file.
 */
export const MESSAGE_FILES: readonly LazyFile[] = ["integrations"];

/** `/integrations`: the installed providers and their credentials. */
export { IntegrationsPage };
