import type { OpenClawPluginApi } from "./plugin-api.js";
import type { RosClawConfig } from "./config.js";
import { parseConfig } from "./config.js";
import {
  readOpenClawConfig,
  writeRosClawConfig,
  getOpenClawConfigPath,
  ConfigFileError,
} from "./config-file.js";
import { getLandingPageHtml } from "./landing-page.js";
import { getConfigPageHtml } from "./config-page.js";
import { registerTeleopRoutes } from "./teleop/routes.js";

async function readJsonBodyFromReq(req: { readJsonBody?: () => Promise<Record<string, unknown> | null>; body?: unknown; on?: (e: string, cb: (c?: Buffer) => void) => void }): Promise<Record<string, unknown>> {
  if (typeof req.readJsonBody === "function") {
    const out = await req.readJsonBody();
    if (out && typeof out === "object") return out;
  }
  const raw = req.body;
  if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
  if (raw && typeof (raw as Promise<unknown>).then === "function") {
    const parsed = await (raw as Promise<Record<string, unknown>>);
    if (parsed && typeof parsed === "object") return parsed;
  }
  if (typeof req.on === "function") {
    const chunks: Buffer[] = [];
    const body = await new Promise<string>((resolve, reject) => {
      (req as NodeJS.ReadableStream).on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      (req as NodeJS.ReadableStream).on("end", () =>
        resolve(Buffer.concat(chunks).toString("utf8")),
      );
      (req as NodeJS.ReadableStream).on("error", reject);
    });
    if (body.trim()) {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
  }
  return {};
}

/**
 * Returns a JSON-serializable copy of config with sensitive fields redacted.
 */
function configForApi(config: RosClawConfig): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const webrtc = out.webrtc as Record<string, unknown> | undefined;
  if (webrtc && typeof webrtc.robotKey === "string" && webrtc.robotKey.length > 0) {
    webrtc.robotKey = "(set)";
  }
  return out;
}

/**
 * Register all RosClaw HTTP routes: landing, config, config API, and teleop.
 * Only call when api.registerHttpRoute is available.
 */
export function registerRoutes(api: OpenClawPluginApi, config: RosClawConfig): void {
  const register = api.registerHttpRoute;
  if (typeof register !== "function") {
    api.logger.info("RosClaw HTTP: registerHttpRoute not available, skipping routes");
    return;
  }

  register({
    path: "/rosclaw/",
    method: "GET",
    handler: (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.statusCode = 200;
      res.end(getLandingPageHtml());
    },
  });

  register({
    path: "/rosclaw/config",
    method: "GET",
    handler: (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.statusCode = 200;
      res.end(getConfigPageHtml());
    },
  });

  register({
    path: "/rosclaw/config.json",
    method: "GET",
    handler: (_req, res) => {
      const payload = configForApi(config);
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      res.end(JSON.stringify(payload));
    },
  });

  register({
    path: "/rosclaw/config/save",
    method: "POST",
    handler: async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      const sendJson = (status: number, data: { success: boolean; error?: string; message?: string; configPath?: string }) => {
        res.statusCode = status;
        res.end(JSON.stringify(data));
      };
      try {
        let body: Record<string, unknown>;
        try {
          body = await readJsonBodyFromReq(req as Parameters<typeof readJsonBodyFromReq>[0]);
        } catch (e) {
          const bodyMsg = e instanceof Error ? e.message : "Invalid request body";
          api.logger.warn("RosClaw config POST invalid body: " + bodyMsg);
          sendJson(400, { success: false, error: bodyMsg });
          return;
        }
        let merged: RosClawConfig;
        try {
          merged = parseConfig(body);
        } catch (err) {
          const msg =
            err && typeof err === "object" && "message" in err
              ? String((err as Error).message)
              : "Validation failed";
          api.logger.warn("RosClaw config save validation failed: " + msg);
          sendJson(400, { success: false, error: msg });
          return;
        }
        let existingRosclaw: Record<string, unknown> | undefined;
        try {
          const full = readOpenClawConfig();
          const plugins = full.plugins as Record<string, unknown> | undefined;
          const entries = plugins?.entries as Record<string, unknown> | undefined;
          const rosclawEntry = entries?.rosclaw as Record<string, unknown> | undefined;
          existingRosclaw = rosclawEntry?.config as Record<string, unknown> | undefined;
        } catch (err) {
          if (err instanceof ConfigFileError && err.code === "ENOENT") {
            api.logger.warn("RosClaw config file missing: " + err.message);
            sendJson(503, { success: false, error: err.message });
            return;
          }
          if (err instanceof ConfigFileError && err.code === "EACCES") {
            api.logger.warn("RosClaw config file access denied: " + err.message);
            sendJson(500, { success: false, error: err.message });
            return;
          }
          const readMsg = err instanceof Error ? err.message : "Failed to read config file";
          api.logger.warn("RosClaw config read failed: " + readMsg);
          sendJson(500, { success: false, error: readMsg });
          return;
        }
        const existingKey =
          (existingRosclaw?.webrtc as Record<string, unknown> | undefined)?.robotKey;
        if (typeof existingKey === "string" && existingKey.length > 0) {
          merged.webrtc.robotKey = existingKey;
        }
        try {
          writeRosClawConfig(merged as unknown as Record<string, unknown>);
        } catch (err) {
          const msg = err instanceof ConfigFileError ? err.message : (err instanceof Error ? err.message : "Failed to write config");
          api.logger.warn("RosClaw config write failed: " + msg);
          sendJson(500, { success: false, error: msg });
          return;
        }
        const configPath = getOpenClawConfigPath();
        sendJson(200, {
          success: true,
          message: "Config saved. Restart the OpenClaw gateway for changes to take effect.",
          configPath,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        api.logger.warn("RosClaw config save error: " + msg);
        sendJson(500, {
          success: false,
          error: msg,
        });
      }
    },
  });

  registerTeleopRoutes(api, config);

  api.logger.info("RosClaw HTTP routes registered (GET /rosclaw/, /config, /config.json; POST /config/save; teleop routes)");
}
