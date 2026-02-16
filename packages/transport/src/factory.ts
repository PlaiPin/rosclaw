import type { TransportConfig } from "./types.js";
import type { RosTransport } from "./transport.js";

/**
 * Dynamically import a module by name.
 *
 * Using a variable prevents TypeScript from trying to resolve the module
 * at compile time. The adapter packages are loaded at runtime by the
 * consuming application (e.g., the plugin), which has them as dependencies.
 */
async function loadAdapter(packageName: string): Promise<Record<string, unknown>> {
  return import(packageName);
}

/**
 * Create a RosTransport instance for the given deployment mode.
 *
 * Uses dynamic import() to load the correct adapter package so that
 * unused adapters (and their dependencies) are never loaded.
 *
 * The calling package must have the relevant adapter as a dependency:
 * - "rosbridge" → @rosclaw/rosbridge-client
 * - "local"     → @rosclaw/transport-local
 * - "webrtc"    → @rosclaw/transport-webrtc
 */
export async function createTransport(config: TransportConfig): Promise<RosTransport> {
  switch (config.mode) {
    case "rosbridge": {
      const mod = await loadAdapter("@rosclaw/rosbridge-client");
      const Adapter = mod.RosbridgeTransport as new (...args: unknown[]) => RosTransport;
      return new Adapter(config.rosbridge);
    }

    case "local": {
      const mod = await loadAdapter("@rosclaw/transport-local");
      const Adapter = mod.LocalTransport as new (...args: unknown[]) => RosTransport;
      return new Adapter(config.local);
    }

    case "webrtc": {
      const mod = await loadAdapter("@rosclaw/transport-webrtc");
      const Adapter = mod.WebRTCTransport as new (...args: unknown[]) => RosTransport;
      return new Adapter(config.webrtc);
    }

    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown transport mode: ${(_exhaustive as TransportConfig).mode}`);
    }
  }
}
