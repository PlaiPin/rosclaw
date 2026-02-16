/**
 * OpenClaw Canvas extension for real-time robot dashboard.
 * Phase 3 — placeholder only.
 */

interface OpenClawPluginAPI {
  log: {
    info(msg: string, ...args: unknown[]): void;
  };
}

export function register(api: OpenClawPluginAPI): void {
  api.log.info("RosClaw Canvas extension loaded (Phase 3 — not yet implemented)");
}
