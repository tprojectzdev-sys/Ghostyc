import { z } from "zod";

const ConfigSchema = z.object({
  GHOSTYC_AGENT_TOKEN: z.string().min(8),
  RELAY_URL: z.string().min(1).refine(
    (v) => /^wss?:\/\//i.test(v) || /^https?:\/\//i.test(v),
    { message: "must start with ws://, wss://, http:// or https://" },
  ),
  PC_NAME: z.string().min(1),
  GHOSTYC_AGENT_LOG_DIR: z.string().default("./logs"),
});

export type AgentConfig = z.infer<typeof ConfigSchema>;

export type ConfigLoadResult =
  | { ok: true; config: AgentConfig }
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

/** Convert a relay URL to the WS endpoint for this role. */
export function wsUrlFor(relayUrl: string, role: "agent" | "client" | "bridge"): string {
  let base = relayUrl.replace(/\/$/, "");
  if (/^http:\/\//i.test(base)) base = "ws://" + base.slice("http://".length);
  else if (/^https:\/\//i.test(base)) base = "wss://" + base.slice("https://".length);
  return `${base}/ws/${role}`;
}
