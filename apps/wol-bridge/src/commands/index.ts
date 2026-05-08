// Bridge command dispatch table. PROTOCOL.md §13.2.
//
// V1 commands:
//   - status   → returns uptime, version (and wifi: null — not collected on V1)
//   - wake_pc  → sends magic packet, returns { packet_sent, packet_bytes }

import * as os from "node:os";
import { z } from "zod";
import type { ErrorObject } from "@ghostyc/protocol";
import type { BridgeConfig } from "../config.js";
import { BRIDGE_VERSION } from "../version.js";
import { sendMagicPacket, WolError } from "../wol.js";

export type CommandOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: ErrorObject };

const WakePcArgsSchema = z
  .object({
    mac: z.string().optional(),
    broadcast: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
  })
  .strict();

const StatusArgsSchema = z.object({}).strict();

export interface ExecutionContext {
  config: BridgeConfig;
  bootedAtMs: number;
}

export async function execute(
  command: string,
  args: unknown,
  request_id: string,
  ctx: ExecutionContext,
): Promise<CommandOutcome> {
  const at = new Date().toISOString();
  try {
    switch (command) {
      case "status": {
        const parsed = StatusArgsSchema.safeParse(args ?? {});
        if (!parsed.success) {
          return badArgs(parsed.error.message, at, request_id);
        }
        return {
          ok: true,
          result: {
            uptime_s: Math.floor((Date.now() - ctx.bootedAtMs) / 1000),
            version: BRIDGE_VERSION,
            // WiFi metrics not collected on V1 — never fabricate.
            wifi: null,
            host: os.hostname(),
          },
        };
      }
      case "wake_pc": {
        const parsed = WakePcArgsSchema.safeParse(args ?? {});
        if (!parsed.success) {
          return badArgs(parsed.error.message, at, request_id);
        }
        const mac = parsed.data.mac ?? ctx.config.PC_MAC_ADDRESS;
        const broadcast = parsed.data.broadcast ?? ctx.config.PC_BROADCAST_ADDRESS;
        const port = parsed.data.port ?? 9;
        try {
          const result = await sendMagicPacket({ mac, broadcast, port });
          return { ok: true, result };
        } catch (err) {
          if (err instanceof WolError) {
            return {
              ok: false,
              error: {
                code: err.code,
                message: err.message,
                at,
                request_id,
              },
            };
          }
          const msg = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            error: {
              code: "wol.send_failed",
              message: msg,
              at,
              request_id,
            },
          };
        }
      }
      default:
        return {
          ok: false,
          error: {
            code: "command.unknown",
            message: `bridge does not implement "${command}"`,
            at,
            request_id,
          },
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        code: "internal.unexpected",
        message: msg,
        at,
        request_id,
        details: { stack: err instanceof Error ? err.stack ?? null : null },
      },
    };
  }
}

function badArgs(reason: string, at: string, request_id: string): CommandOutcome {
  return {
    ok: false,
    error: {
      code: "command.bad_args",
      message: reason,
      at,
      request_id,
    },
  };
}
