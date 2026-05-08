// Agent command registry. Phase 1: only `status` is implemented.
// Each command returns either a result payload or an Error object on failure.

import { type ErrorObject } from "@ghostyc/protocol";
import { runStatus } from "./status.js";
import { runLock } from "./lock.js";
import { runSleep } from "./sleep.js";
import { runShutdown } from "./shutdown.js";
import { runRestart } from "./restart.js";
import { runOpenApp } from "./open_app.js";
import { runOpenWebsite } from "./open_website.js";
import { runListProcesses } from "./list_processes.js";
import { runKillProcess } from "./kill_process.js";
import { runScreenshot } from "./screenshot.js";

export type CommandHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface CommandFailure {
  ok: false;
  error: ErrorObject;
}

const handlers: Record<string, CommandHandler> = {
  status: async (_args) => runStatus(),
  lock: async (_args) => runLock(),
  sleep: async (_args) => runSleep(),
  shutdown: async (args) => runShutdown(args),
  restart: async (args) => runRestart(args),
  open_app: async (args) => runOpenApp(args),
  open_website: async (args) => runOpenWebsite(args),
  list_processes: async (args) => runListProcesses(args),
  kill_process: async (args) => runKillProcess(args),
  screenshot: async (args) => runScreenshot(args),
};

export function isKnownCommand(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(handlers, name);
}

export async function execute(
  name: string,
  args: Record<string, unknown>,
  request_id: string,
): Promise<{ ok: true; result: unknown } | CommandFailure> {
  const handler = handlers[name];
  if (!handler) {
    return {
      ok: false,
      error: {
        code: "command.not_implemented",
        message: `command '${name}' is not implemented in this agent build`,
        at: new Date().toISOString(),
        request_id,
      },
    };
  }
  try {
    const result = await handler(args);
    return { ok: true, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Preserve a specific protocol error code if the handler set one (e.g.
    // command.image_too_large, command.not_implemented). Otherwise fall back
    // to the generic command.failed.
    const specificCode = (err as { code?: unknown }).code;
    const code =
      typeof specificCode === "string" && specificCode.startsWith("command.")
        ? specificCode
        : "command.failed";
    return {
      ok: false,
      error: {
        code,
        message: msg,
        at: new Date().toISOString(),
        request_id,
        details: { stack: err instanceof Error ? err.stack ?? null : null },
      },
    };
  }
}
