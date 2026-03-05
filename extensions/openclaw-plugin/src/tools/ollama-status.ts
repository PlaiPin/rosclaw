/**
 * Tool to check if Ollama is reachable and which models are available.
 * Use when the user asks "is Qwen running?" or when Follow Me has no detections and we need to verify the VLM pipeline.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";

const CHECK_TIMEOUT_MS = 5000;

export function registerOllamaStatusTool(
  api: OpenClawPluginApi,
  config: RosClawConfig,
): void {
  api.registerTool({
    name: "ollama_status",
    label: "Ollama status",
    description:
      "Check if Ollama is reachable and list available models (e.g. for Follow Me's Qwen VLM). " +
      "Use when the user asks if Qwen/Ollama is running, or when Follow Me reports no detections and you need to verify the vision pipeline.",

    parameters: Type.Object({
      url: Type.Optional(
        Type.String({
          description: "Ollama API base URL. Default: from plugin config (followMe.ollamaUrl) or http://localhost:11434.",
        }),
      ),
    }),

    async execute(_toolCallId, params) {
      const baseUrl = (params["url"] as string | undefined)?.trim()
        || (config.followMe?.ollamaUrl ?? "http://localhost:11434").replace(/\/$/, "");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
      try {
        const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const t = await res.text();
          return {
            content: [{
              type: "text" as const,
              text: `Ollama at ${baseUrl} returned ${res.status}: ${t.slice(0, 200)}. Not running or wrong URL?`,
            }],
            details: { reachable: false, url: baseUrl, status: res.status, error: t.slice(0, 200) },
          };
        }
        const json = (await res.json()) as { models?: Array<{ name?: string }> };
        const models = (json.models ?? []).map((m) => m.name ?? "").filter(Boolean);
        const vlmModel = config.followMe?.vlmModel ?? "qwen3-vl:2b";
        const hasVlm = models.some((n) => n === vlmModel || n.startsWith(vlmModel.split(":")[0] + ":"));
        const visionLike = models.filter((n) => /vl|vision/i.test(n));
        const suggest = visionLike.length > 0 ? visionLike[0] : models[0];
        let text = `Ollama is reachable at ${baseUrl}. Models: ${models.length ? models.join(", ") : "none"}.`;
        if (!hasVlm && models.length > 0) {
          text += ` Follow Me is currently configured for "${vlmModel}" (not in list). To use what you have: set followMe.vlmModel to "${suggest}" in the RosClaw plugin config and restart Follow Me. No need to pull another model.`;
        } else if (!hasVlm) {
          text += ` No models listed. Pull a vision model: ollama run ${vlmModel}.`;
        } else {
          text += ` Follow Me is configured for ${vlmModel} and it is available.`;
        }
        return {
          content: [{ type: "text" as const, text }],
          details: { reachable: true, url: baseUrl, models, vlm_model_expected: vlmModel },
        };
      } catch (err) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error ? err.message : String(err);
        const isAbort = err instanceof Error && err.name === "AbortError";
        const text = isAbort
          ? `Ollama at ${baseUrl} did not respond within ${CHECK_TIMEOUT_MS}ms. Is it running? (Gateway may not reach that host.)`
          : `Ollama check failed: ${msg}. Is Ollama running at ${baseUrl}?`;
        return {
          content: [{ type: "text" as const, text }],
          details: { reachable: false, url: baseUrl, error: msg },
        };
      }
    },
  });
}
