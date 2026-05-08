// Relay env config — validated on boot. PROTOCOL.md §14.

import { z } from "zod";

const ConfigSchema = z.object({
  GHOSTYC_CLIENT_TOKEN: z.string().min(8, "must be at least 8 chars"),
  GHOSTYC_AGENT_TOKEN: z.string().min(8, "must be at least 8 chars"),
  GHOSTYC_BRIDGE_TOKEN: z.string().min(8, "must be at least 8 chars"),
  GHOSTYC_ADMIN_PASSWORD: z.string().min(4, "must be at least 4 chars"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  GHOSTYC_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(500),
  GHOSTYC_HEARTBEAT_MS: z.coerce.number().int().min(5000).max(60000).default(25000),
  GHOSTYC_HEARTBEAT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10000)
    .max(600000)
    .default(60000),

  GHOSTYC_LOG_DIR: z.string().optional(),
});

export type RelayConfig = z.infer<typeof ConfigSchema>;

export interface ConfigLoadResult {
  ok: true;
  config: RelayConfig;
}

export interface ConfigLoadFailure {
  ok: false;
  missing: string[];
  invalid: { key: string; reason: string }[];
}

export function loadConfig(env: NodeJS.ProcessEnv): ConfigLoadResult | ConfigLoadFailure {
  const parsed = ConfigSchema.safeParse(env);
  if (parsed.success) {
    const uniq = new Set([
      parsed.data.GHOSTYC_CLIENT_TOKEN,
      parsed.data.GHOSTYC_AGENT_TOKEN,
      parsed.data.GHOSTYC_BRIDGE_TOKEN,
    ]);
    if (uniq.size !== 3) {
      return {
        ok: false,
        missing: [],
        invalid: [
          {
            key: "GHOSTYC_*_TOKEN",
            reason: "client/agent/bridge tokens must all be distinct",
          },
        ],
      };
    }
    if (
      parsed.data.GHOSTYC_ADMIN_PASSWORD === parsed.data.GHOSTYC_CLIENT_TOKEN ||
      parsed.data.GHOSTYC_ADMIN_PASSWORD === parsed.data.GHOSTYC_AGENT_TOKEN ||
      parsed.data.GHOSTYC_ADMIN_PASSWORD === parsed.data.GHOSTYC_BRIDGE_TOKEN
    ) {
      return {
        ok: false,
        missing: [],
        invalid: [
          {
            key: "GHOSTYC_ADMIN_PASSWORD",
            reason: "must not match any auth token",
          },
        ],
      };
    }
    if (
      parsed.data.GHOSTYC_HEARTBEAT_TIMEOUT_MS <
      parsed.data.GHOSTYC_HEARTBEAT_MS * 2
    ) {
      return {
        ok: false,
        missing: [],
        invalid: [
          {
            key: "GHOSTYC_HEARTBEAT_TIMEOUT_MS",
            reason: "must be >= 2 * GHOSTYC_HEARTBEAT_MS (PROTOCOL §10)",
          },
        ],
      };
    }
    return { ok: true, config: parsed.data };
  }

  const missing: string[] = [];
  const invalid: { key: string; reason: string }[] = [];
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "(root)");
    if (
      issue.code === "invalid_type" &&
      issue.received === "undefined"
    ) {
      missing.push(key);
    } else {
      invalid.push({ key, reason: issue.message });
    }
  }
  return { ok: false, missing, invalid };
}
