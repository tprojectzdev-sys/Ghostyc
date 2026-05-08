// Bridge env config — validated on boot. PROTOCOL.md §14.

import { z } from "zod";

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

const ConfigSchema = z.object({
  GHOSTYC_BRIDGE_TOKEN: z.string().min(8, "must be at least 8 chars"),
  RELAY_URL: z
    .string()
    .min(1)
    .refine(
      (v) => /^wss?:\/\//i.test(v) || /^https?:\/\//i.test(v),
      { message: "must start with ws://, wss://, http:// or https://" },
    ),
  PC_MAC_ADDRESS: z
    .string()
    .refine((v) => MAC_RE.test(v), {
      message: "must be AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF",
    }),
  PC_BROADCAST_ADDRESS: z
    .string()
    .refine((v) => IPV4_RE.test(v), { message: "must be IPv4 dotted quad" }),
  GHOSTYC_BRIDGE_LOG_DIR: z.string().default("./logs"),
});

export type BridgeConfig = z.infer<typeof ConfigSchema>;

export type ConfigLoadResult =
  | { ok: true; config: BridgeConfig }
  | { ok: false; missing: string[]; invalid: { key: string; reason: string }[] };

export function loadConfig(env: NodeJS.ProcessEnv): ConfigLoadResult {
  const parsed = ConfigSchema.safeParse(env);
  if (parsed.success) return { ok: true, config: parsed.data };
  const missing: string[] = [];
  const invalid: { key: string; reason: string }[] = [];
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "(root)");
    if (issue.code === "invalid_type" && issue.received === "undefined") {
      missing.push(key);
    } else {
      invalid.push({ key, reason: issue.message });
    }
  }
  return { ok: false, missing, invalid };
}

/** Convert an http(s)/ws(s) relay URL to the /ws/bridge WS endpoint. */
export function bridgeWsUrl(relayUrl: string): string {
  let base = relayUrl.replace(/\/$/, "");
  if (/^http:\/\//i.test(base)) base = "ws://" + base.slice("http://".length);
  else if (/^https:\/\//i.test(base)) base = "wss://" + base.slice("https://".length);
  return `${base}/ws/bridge`;
}
