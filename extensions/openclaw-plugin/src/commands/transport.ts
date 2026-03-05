import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import type { TransportConfig } from "../transport/types.js";
import { getTransport, getTransportMode, switchTransport } from "../service.js";
import { clearDiscoveryCache } from "../context/robot-context.js";

const VALID_MODES = ["rosbridge", "local", "webrtc", "zenoh"] as const;
type Mode = (typeof VALID_MODES)[number];

function isValidMode(value: string): value is Mode {
  return (VALID_MODES as readonly string[]).includes(value);
}

/**
 * Register the /transport command for runtime transport switching.
 */
export function registerTransportCommand(api: OpenClawPluginApi, config: RosClawConfig): void {
  api.registerCommand({
    name: "transport",
    description: "Show or switch the ROS2 transport mode (rosbridge, webrtc, local, zenoh)",

    async handler(ctx) {
      const args = (ctx.args ?? "").trim();

      // No args → show current status
      if (!args) {
        return showStatus();
      }

      // Parse mode from first arg
      const parts = args.split(/\s+/);
      const modeArg = parts[0];

      if (!isValidMode(modeArg)) {
        return {
          text: `Unknown transport mode: "${modeArg}". Valid modes: ${VALID_MODES.join(", ")}`,
        };
      }

      // Build TransportConfig from base config + overrides
      let transportConfig: TransportConfig;
      try {
        transportConfig = buildTransportConfig(modeArg, parts.slice(1), config);
      } catch (err) {
        return { text: `Invalid arguments: ${String(err)}` };
      }

      // Perform the switch
      try {
        await switchTransport(transportConfig, api.logger);
        clearDiscoveryCache();
        return { text: formatSwitchSuccess(transportConfig) };
      } catch (err) {
        return {
          text: `Failed to switch transport: ${String(err)}\nYou can retry with /transport ${modeArg}`,
        };
      }
    },
  });
}

function showStatus(): { text: string } {
  const mode = getTransportMode();

  if (!mode) {
    return { text: "Transport: not active" };
  }

  try {
    const transport = getTransport();
    const status = transport.getStatus();
    return { text: `Transport: ${mode} (${status})` };
  } catch {
    return { text: `Transport: ${mode} (unknown status)` };
  }
}

/**
 * Build a TransportConfig from base config + positional/key=value overrides.
 */
function buildTransportConfig(
  mode: Mode,
  overrides: string[],
  config: RosClawConfig,
): TransportConfig {
  switch (mode) {
    case "rosbridge": {
      const base = { ...config.rosbridge };

      for (const arg of overrides) {
        if (arg.startsWith("ws://") || arg.startsWith("wss://")) {
          // Positional URL override
          base.url = arg;
        } else if (arg.includes("=")) {
          const [key, ...rest] = arg.split("=");
          const value = rest.join("=");
          applyOverride(base, key, value);
        } else {
          throw new Error(`Unexpected argument: "${arg}"`);
        }
      }

      return { mode: "rosbridge", rosbridge: base };
    }

    case "webrtc": {
      const base = { ...config.webrtc };

      for (const arg of overrides) {
        if (!arg.includes("=")) {
          throw new Error(`Unexpected argument: "${arg}". Use key=value format.`);
        }
        const [key, ...rest] = arg.split("=");
        const value = rest.join("=");
        applyOverride(base, key, value);
      }

      return { mode: "webrtc", webrtc: base };
    }

    case "local": {
      const base = { ...config.local };

      for (const arg of overrides) {
        if (!arg.includes("=")) {
          throw new Error(`Unexpected argument: "${arg}". Use key=value format.`);
        }
        const [key, ...rest] = arg.split("=");
        const value = rest.join("=");
        applyOverride(base, key, value);
      }

      return { mode: "local", local: base };
    }

    case "zenoh": {
      const base = { ...config.zenoh };

      for (const arg of overrides) {
        if (arg.includes("=")) {
          const [key, ...rest] = arg.split("=");
          const value = rest.join("=");
          applyOverride(base as Record<string, unknown>, key, value);
        } else if (arg.startsWith("ws://") || arg.startsWith("wss://") || /^[a-z]+\/\S+/.test(arg)) {
          base.routerEndpoint = arg;
        } else {
          throw new Error(`Unexpected argument: "${arg}". Use key=value or router endpoint.`);
        }
      }

      return { mode: "zenoh", zenoh: base };
    }
  }
}

/** Apply a key=value override to a config object. */
function applyOverride(obj: Record<string, unknown>, key: string, value: string): void {
  if (!(key in obj)) {
    throw new Error(`Unknown config key: "${key}"`);
  }

  const existing = obj[key];

  // Coerce value to match existing type
  if (typeof existing === "number") {
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new Error(`"${key}" expects a number, got "${value}"`);
    }
    obj[key] = num;
  } else if (typeof existing === "boolean") {
    obj[key] = value === "true";
  } else {
    obj[key] = value;
  }
}

function formatSwitchSuccess(config: TransportConfig): string {
  switch (config.mode) {
    case "rosbridge":
      return `Switched to rosbridge transport (${config.rosbridge.url})`;
    case "webrtc": {
      const robotId = config.webrtc.robotId;
      return `Switched to webrtc transport (robotId: ${robotId})`;
    }
    case "local":
      return `Switched to local transport (domainId: ${config.local?.domainId ?? 0})`;
    case "zenoh":
      return `Switched to zenoh transport (${config.zenoh.routerEndpoint})`;
    default: {
      const _: never = config;
      return `Switched to ${(_ as TransportConfig).mode} transport`;
    }
  }
}
