#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const serverPath = resolve(
  process.env.ROSCLAW_MCP_SERVER_PATH ??
    "./extensions/rosclaw-codex-mcp-server/dist/index.js",
);

try {
  await access(serverPath);
} catch {
  console.error(
    [
      `RosClaw MCP server not found at ${serverPath}.`,
      "Build it from the RosClaw repo first:",
      "  pnpm --filter @rosclaw/rosclaw-codex-mcp-server build",
      "If Claude was launched outside the RosClaw repo, set ROSCLAW_MCP_SERVER_PATH.",
    ].join("\n"),
  );
  process.exit(1);
}

const child = spawn(process.execPath, [serverPath], {
  env: process.env,
  stdio: "inherit",
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
