// Ghostyc protocol — shared types and runtime schemas.
// Mirrors docs/PROTOCOL.md. Bump PROTOCOL_VERSION on any breaking change.

import { z } from "zod";

export const PROTOCOL_VERSION = "1.0.0-draft";
export const ENVELOPE_VERSION = 1;

// ── Roles ──────────────────────────────────────────────────────────────────

export const RoleSchema = z.enum(["client", "agent", "bridge"]);
export type Role = z.infer<typeof RoleSchema>;

// ── Log event schema (PROTOCOL §6.1) ───────────────────────────────────────

export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const ServiceSchema = z.enum(["relay", "agent", "bridge", "client"]);
export type Service = z.infer<typeof ServiceSchema>;

export const ErrorObjectSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  at: z.string(),
  request_id: z.string().nullable().optional(),
});
export type ErrorObject = z.infer<typeof ErrorObjectSchema>;

export const LogEventSchema = z.object({
  timestamp: z.string(),
  service: ServiceSchema,
  device: z.string(),
  level: LogLevelSchema,
  event: z.string(),
  message: z.string(),
  request_id: z.string().nullable().optional(),
  correlation_id: z.string().nullable().optional(),
  command: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  error: ErrorObjectSchema.nullable().optional(),
  retry_count: z.number().nullable().optional(),
  connection_state: z.string().nullable().optional(),
  context: z.record(z.unknown()).optional(),
});
export type LogEvent = z.infer<typeof LogEventSchema>;

// ── WS envelope (PROTOCOL §4.2) ────────────────────────────────────────────

export const WsMessageTypeSchema = z.enum([
  "hello",
  "welcome",
  "error",
  "heartbeat",
  "device.status",
  "command.dispatch",
  "command.ack",
  "command.result",
  "log.event",
]);
export type WsMessageType = z.infer<typeof WsMessageTypeSchema>;

export const WsEnvelopeSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  type: WsMessageTypeSchema,
  id: z.string(),
  request_id: z.string().nullable().optional(),
  correlation_id: z.string().nullable().optional(),
  ts: z.string(),
  data: z.unknown(),
});
export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;

// ── Hello / Welcome (PROTOCOL §4.3) ────────────────────────────────────────

export const HelloDataSchema = z.object({
  role: RoleSchema,
  device_id: z.string().min(1),
  token: z.string().min(1),
  version: z.string(),
  protocol_version: z.string(),
});
export type HelloData = z.infer<typeof HelloDataSchema>;

export const WelcomeDataSchema = z.object({
  session_id: z.string(),
  server_time: z.string(),
  heartbeat_interval_ms: z.number().int().positive(),
  heartbeat_timeout_ms: z.number().int().positive(),
});
export type WelcomeData = z.infer<typeof WelcomeDataSchema>;

// ── Heartbeat (PROTOCOL §5.2) ──────────────────────────────────────────────

export const HeartbeatDataSchema = z.object({
  device_id: z.string(),
  role: RoleSchema,
  uptime_s: z.number(),
  version: z.string(),
  metrics: z
    .object({
      cpu_percent: z.number().nullable(),
      mem_percent: z.number().nullable(),
      wifi_signal: z.number().nullable(),
    })
    .partial()
    .optional(),
});
export type HeartbeatData = z.infer<typeof HeartbeatDataSchema>;

// ── Commands (PROTOCOL §13) ────────────────────────────────────────────────

export const CommandTargetSchema = z.enum(["agent", "bridge"]);
export type CommandTarget = z.infer<typeof CommandTargetSchema>;

export const CommandStateSchema = z.enum([
  "accepted",
  "running",
  "success",
  "failed",
  "timeout",
  "target_offline",
  "rejected",
]);
export type CommandState = z.infer<typeof CommandStateSchema>;

export const CommandResultStateSchema = z.enum([
  "success",
  "failed",
  "timeout",
  "target_offline",
]);
export type CommandResultState = z.infer<typeof CommandResultStateSchema>;

// Phase 1: only `status` is implemented end-to-end. The full set is declared so
// schemas exist for later phases, but the relay/agent will reject any command
// not present in their dispatch tables.
export const AgentCommandNameSchema = z.enum([
  "status",
  "lock",
  "sleep",
  "shutdown",
  "restart",
  "open_app",
  "open_website",
  "list_processes",
  "kill_process",
  "screenshot",
]);
export type AgentCommandName = z.infer<typeof AgentCommandNameSchema>;

export const BridgeCommandNameSchema = z.enum(["wake_pc", "status"]);
export type BridgeCommandName = z.infer<typeof BridgeCommandNameSchema>;

// ── REST request/response shapes ───────────────────────────────────────────

export const PostCommandRequestSchema = z.object({
  target: CommandTargetSchema,
  command: z.string().min(1),
  args: z.record(z.unknown()).optional().default({}),
  // Outer bound. Per-command clamps are applied server-side (PROTOCOL §10/§13).
  // wake_pc on the bridge clamps to [10000, 300000]; agent commands typically
  // clamp into [1000, 60000].
  timeout_ms: z.number().int().min(1000).max(300000).optional(),
  request_id: z.string().uuid().optional(),
});
export type PostCommandRequest = z.infer<typeof PostCommandRequestSchema>;

export interface PostCommandAccepted {
  request_id: string;
  status: "accepted";
  submitted_at: string;
}

export interface PostCommandRejected {
  request_id: string;
  status: "rejected";
  reason: string;
  error: ErrorObject;
}

export interface DeviceSnapshot {
  device_id: string;
  role: Role;
  status: "online" | "offline" | "degraded" | "unknown";
  last_heartbeat: string | null;
  connected_since: string | null;
  reconnect_count: number;
  version: string | null;
}

export interface CommandRecord {
  request_id: string;
  target: CommandTarget;
  command: string;
  state: CommandState;
  submitted_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: unknown;
  error: ErrorObject | null;
}

export interface DiagnosticsSnapshot {
  relay: {
    status: "ok" | "degraded";
    uptime_s: number;
    protocol_version: string;
    ws_clients_connected: number;
    log_buffer_size: number;
    log_buffer_capacity: number;
    persistent_logs: { enabled: boolean; dir: string | null };
  };
  agent: (DeviceSnapshot & {
    last_command: Pick<
      CommandRecord,
      "request_id" | "command" | "state" | "finished_at"
    > | null;
    last_error: ErrorObject | null;
  }) | null;
  bridge: (DeviceSnapshot & {
    last_wake_attempt: string | null;
    last_error: ErrorObject | null;
  }) | null;
  auth: {
    client_token_present: boolean;
    agent_token_present: boolean;
    bridge_token_present: boolean;
  };
  request_id: string;
}

// ── Result data shapes used in Phase 1 ─────────────────────────────────────

export interface StatusCommandResult {
  os: string;
  hostname: string;
  uptime_s: number;
  version: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Redact tokens/passwords from any object before logging or broadcasting.
 * Mutates a shallow copy; the input is not changed.
 */
export function redactSecrets<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (lk === "token" || lk === "password" || lk === "authorization") {
      out[k] = "[redacted]";
    } else {
      out[k] = redactSecrets(v);
    }
  }
  return out as T;
}
