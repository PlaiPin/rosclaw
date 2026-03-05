/**
 * Type declarations matching the real OpenClaw plugin SDK.
 *
 * Only the subset used by the rosclaw plugin is declared here.
 * These types mirror openclaw/plugin-sdk so that the plugin compiles
 * without importing the SDK at build time (it is provided at runtime).
 */

import type { TSchema } from "@sinclair/typebox";

// --- Logger ---

export interface PluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

// --- Tools ---

export interface AgentTool {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult>;
}

export interface ToolResult {
  content: ToolContent[];
  details?: unknown;
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

// --- Services ---

export interface ServiceContext {
  config: Record<string, unknown>;
  stateDir: string;
  logger: PluginLogger;
}

export interface PluginService {
  id: string;
  start(ctx: ServiceContext): Promise<void>;
  stop?(ctx: ServiceContext): Promise<void>;
}

// --- Commands ---

export interface CommandContext {
  senderId?: string;
  channel: string;
  channelId?: string;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  config: Record<string, unknown>;
  from?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: number;
}

export interface PluginCommand {
  name: string;
  description: string;
  handler(ctx: CommandContext): Promise<CommandResult> | CommandResult;
}

export interface CommandResult {
  text: string;
}

// --- Hooks ---

export interface BeforeAgentStartEvent {
  prompt: string;
}

export interface BeforeAgentStartResult {
  prependContext?: string;
}

export interface BeforeAgentStartContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
}

export type BeforeAgentStartHandler = (
  event: BeforeAgentStartEvent,
  ctx: BeforeAgentStartContext,
) => Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void;

export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
}

export interface BeforeToolCallResult {
  block?: boolean;
  blockReason?: string;
}

export interface BeforeToolCallContext {
  agentId?: string;
  sessionKey?: string;
  toolName: string;
}

export type BeforeToolCallHandler = (
  event: BeforeToolCallEvent,
  ctx: BeforeToolCallContext,
) => Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;

// --- HTTP routes (Phase 3 teleop) ---

/** Minimal request shape for plugin HTTP route handlers (gateway provides at runtime). */
export interface HttpRouteRequest {
  method: string;
  url: string;
  /** Read JSON body (e.g. for POST). May throw if body is invalid. */
  readJsonBody?(): Promise<Record<string, unknown>>;
}

/** Minimal response shape for plugin HTTP route handlers (Node-style; gateway provides at runtime). */
export interface HttpRouteResponse {
  setHeader(name: string, value: string | number): void;
  /** HTTP status code (e.g. res.statusCode = 200). */
  statusCode: number;
  end(body?: string | Buffer): void;
}

export type HttpRouteHandler = (
  req: HttpRouteRequest,
  res: HttpRouteResponse,
) => void | Promise<void>;

export interface HttpRouteOptions {
  path: string;
  method?: string;
  handler: HttpRouteHandler;
}

// --- Plugin API ---

export interface OpenClawPluginApi {
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;

  registerTool(tool: AgentTool, opts?: { name?: string; names?: string[]; optional?: boolean }): void;
  registerService(service: PluginService): void;
  registerCommand(command: PluginCommand): void;
  /** Register an HTTP route (e.g. for Phase 3 teleop). Optional; gateway may not provide it. */
  registerHttpRoute?(options: HttpRouteOptions): void;

  on(hookName: "before_agent_start", handler: BeforeAgentStartHandler): void;
  on(hookName: "before_tool_call", handler: BeforeToolCallHandler): void;
}
