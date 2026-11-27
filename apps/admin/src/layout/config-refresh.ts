/** Invalidate config hints after integration lifecycle changes; backend admission remains authoritative. */
export const ADMIN_CONFIG_REFRESH = "fluxkit:admin-config-refresh";
export function refreshAdminConfig(): void {
  window.dispatchEvent(new Event(ADMIN_CONFIG_REFRESH));
}
