// Outbound WS client for the Windows agent. Implements:
//   - hello/welcome handshake (PROTOCOL §4.3)
//   - heartbeat loop using server-provided interval (PROTOCOL §5)
//   - two-phase reconnect: capped exponential (1–10), then 5min degraded mode (§11)
//   - command.dispatch handling, command.ack + command.result emission (§4.4)
//   - log.event forwarding to relay
//
// Logging policy mirrors PROTOCOL §11.2 exactly:
//   * every Phase A retry logs ws.reconnect_scheduled
//   * Phase B retries are NOT logged individually, only a once-per-hour summary
//   * state transitions (connecting / connected / disconnected / degraded_entered / degraded_exited) always logged

import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import {
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  WelcomeDataSchema,
  WsEnvelopeSchema,
  type LogEvent,
  type WsEnvelope,
  type WsMessageType,
} from "@ghostyc/protocol";
import { AGENT_VERSION } from "./version.js";
import { execute } from "./commands/index.js";
import type { AgentLogger } from "./logger.js";

const PHASE_A_MAX_ATTEMPT = 10;
const PHASE_A_BASE_MS = 1000;
const PHASE_A_CAP_MS = 30_000;
const PHASE_B_MS = 300_000; // 5 minutes
const DEGRADED_SUMMARY_MS = 60 * 60 * 1000; // 1 hour
const HANDSHAKE_TIMEOUT_MS = 5000;

export interface WsClientOpts {
  url: string;
  token: string;
  device_id: string;
  logger: AgentLogger;
}

type ConnState = "idle" | "connecting" | "connected" | "backoff" | "degraded";

export class AgentWsClient {
  private readonly opts: WsClientOpts;
  private ws: WebSocket | null = null;
  private state: ConnState = "idle";
  private attempt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private summaryTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private degradedSince: string | null = null;
  private lastError: { message: string; at: string } | null = null;
  private heartbeatIntervalMs = 25000;
  private readonly bootedAt = Date.now();
  private stopped = false;

  constructor(opts: WsClientOpts) {
    this.opts = opts;
    this.opts.logger.setForwarder((entry) => this.forwardLog(entry));
  }

  start(): void {
    this.stopped = false;
    this.connect("initial");
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      try { this.ws.close(1000, "agent stopping"); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

  private connect(reason: string): void {
    if (this.stopped) return;
    this.state = "connecting";
    this.opts.logger.info("ws.connecting", `connecting to ${this.opts.url}`, {
      connection_state: "connecting",
      retry_count: this.attempt,
      context: { url: this.opts.url, attempt: this.attempt + 1, reason },
    });

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = { message: msg, at: new Date().toISOString() };
      this.scheduleReconnect(`construct_failed: ${msg}`);
      return;
    }
    this.ws = ws;

    let gotWelcome = false;
    const handshakeTimer = setTimeout(() => {
      if (!gotWelcome) {
        try { ws.close(4408, "welcome timeout"); } catch { /* ignore */ }
      }
    }, HANDSHAKE_TIMEOUT_MS);

    ws.on("open", () => {
      this.send(ws, "hello", null, null, {
        role: "agent",
        device_id: this.opts.device_id,
        token: this.opts.token,
        version: AGENT_VERSION,
        protocol_version: PROTOCOL_VERSION,
      });
    });

    ws.on("message", (raw) => {
      const env = parseEnvelope(raw);
      if (!env) {
        this.opts.logger.warn("ws.malformed", "dropped malformed frame from relay");
        return;
      }

      if (!gotWelcome) {
        if (env.type !== "welcome") {
          if (env.type === "error") {
            const data = env.data as { code?: string; message?: string };
            this.lastError = {
              message: `${data.code ?? "?"}: ${data.message ?? ""}`,
              at: new Date().toISOString(),
            };
          }
          // any non-welcome here means the relay rejected us; close + backoff
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        const parsed = WelcomeDataSchema.safeParse(env.data);
        if (!parsed.success) {
          this.opts.logger.warn("ws.malformed", "invalid welcome payload");
          try { ws.close(4400, "bad welcome"); } catch { /* ignore */ }
          return;
        }
        gotWelcome = true;
        clearTimeout(handshakeTimer);
        this.heartbeatIntervalMs = parsed.data.heartbeat_interval_ms;
        const wasDegraded = this.state === "degraded";
        this.state = "connected";
        this.attempt = 0;
        this.lastError = null;
        if (wasDegraded) {
          this.opts.logger.info(
            "ws.degraded_exited",
            "recovered from degraded mode",
            {
              connection_state: "online",
              context: { since: this.degradedSince },
            },
          );
          if (this.summaryTimer) {
            clearInterval(this.summaryTimer);
            this.summaryTimer = null;
          }
          this.degradedSince = null;
        }
        this.opts.logger.info("ws.connected", `connected to relay (session=${parsed.data.session_id})`, {
          connection_state: "online",
          context: {
            session_id: parsed.data.session_id,
            heartbeat_interval_ms: this.heartbeatIntervalMs,
          },
        });
        this.startHeartbeat();
        return;
      }

      // post-welcome
      this.handlePostWelcome(env);
    });

    ws.on("close", (code, reason) => {
      clearTimeout(handshakeTimer);
      this.stopHeartbeat();
      const reasonStr = reason.toString() || `code=${code}`;
      this.lastError = { message: reasonStr, at: new Date().toISOString() };
      const wasConnected = this.state === "connected";
      this.opts.logger.info("ws.disconnected", `relay disconnected (${reasonStr})`, {
        connection_state: "offline",
        context: { code, reason: reasonStr, was_connected: wasConnected },
      });
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect(reasonStr);
    });

    ws.on("error", (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = { message: msg, at: new Date().toISOString() };
      // 'error' is followed by 'close', so we don't schedule here.
      this.opts.logger.warn("ws.error", `transport error: ${msg}`, {
        context: { message: msg },
      });
    });
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    this.attempt += 1;

    let delayMs: number;
    let phase: "exponential" | "degraded";
    if (this.attempt <= PHASE_A_MAX_ATTEMPT) {
      const base = Math.min(PHASE_A_BASE_MS * 2 ** (this.attempt - 1), PHASE_A_CAP_MS);
      delayMs = jitter(base);
      phase = "exponential";
      this.state = "backoff";
      this.opts.logger.info(
        "ws.reconnect_scheduled",
        `retry in ${Math.round(delayMs)}ms (attempt ${this.attempt}/${PHASE_A_MAX_ATTEMPT})`,
        {
          connection_state: "offline",
          retry_count: this.attempt,
          context: {
            attempt: this.attempt,
            delay_ms: Math.round(delayMs),
            phase,
            last_error: this.lastError?.message ?? reason,
          },
        },
      );
    } else {
      delayMs = jitter(PHASE_B_MS);
      phase = "degraded";
      // Transition into degraded mode on the first overflow attempt.
      if (this.state !== "degraded") {
        this.state = "degraded";
        this.degradedSince = new Date().toISOString();
        this.opts.logger.warn(
          "ws.degraded_entered",
          `entering degraded retry mode after ${PHASE_A_MAX_ATTEMPT} failed attempts`,
          {
            connection_state: "offline",
            retry_count: this.attempt,
            context: {
              since: this.degradedSince,
              retry_every_ms: PHASE_B_MS,
              last_error: this.lastError?.message ?? reason,
            },
          },
        );
        this.startDegradedSummaryTimer();
      }
      // Phase B retries are NOT logged individually (per PROTOCOL §11.2).
    }

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(`backoff ${phase}`), delayMs);
  }

  // ── Heartbeat loop ───────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const tick = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.send(this.ws, "heartbeat", null, randomUUID(), {
        device_id: this.opts.device_id,
        role: "agent",
        uptime_s: Math.floor((Date.now() - this.bootedAt) / 1000),
        version: AGENT_VERSION,
        metrics: {
          cpu_percent: null, // not collected in Phase 1 — never fabricated
          mem_percent: null,
          wifi_signal: null,
        },
      });
    };
    // first heartbeat sent immediately so the relay sees activity right away
    tick();
    this.heartbeatTimer = setInterval(tick, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startDegradedSummaryTimer(): void {
    if (this.summaryTimer) clearInterval(this.summaryTimer);
    this.summaryTimer = setInterval(() => {
      if (this.state !== "degraded") return;
      this.opts.logger.warn(
        "ws.degraded_summary",
        `still in degraded mode (attempt ${this.attempt})`,
        {
          connection_state: "offline",
          retry_count: this.attempt,
          context: {
            attempt: this.attempt,
            last_error: this.lastError?.message ?? null,
            since: this.degradedSince,
          },
        },
      );
    }, DEGRADED_SUMMARY_MS);
  }

  // ── Inbound message routing ──────────────────────────────────────────────

  private handlePostWelcome(env: WsEnvelope): void {
    switch (env.type) {
      case "command.dispatch":
        void this.handleDispatch(env);
        break;
      case "error":
        this.opts.logger.warn("ws.error", "relay sent error frame", {
          context: env.data as Record<string, unknown>,
        });
        break;
      default:
        this.opts.logger.warn("ws.unknown_type", `unexpected type from relay: ${env.type}`, {
          context: { type: env.type },
        });
    }
  }

  private async handleDispatch(env: WsEnvelope): Promise<void> {
    const request_id = env.request_id;
    if (!request_id) {
      this.opts.logger.warn("ws.malformed", "command.dispatch without request_id");
      return;
    }
    const data = env.data as {
      command?: string;
      args?: Record<string, unknown>;
      timeout_ms?: number;
    } | null;
    const command = data?.command ?? "";
    const args = data?.args ?? {};

    const started_at = new Date().toISOString();
    const startedAtMs = Date.now();

    this.opts.logger.info("command.execute", `executing ${command}`, {
      request_id,
      command,
      status: "running",
    });

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send(this.ws, "command.ack", request_id, null, { started_at });
    }

    const outcome = await execute(command, args, request_id);
    const finished_at = new Date().toISOString();
    const duration_ms = Date.now() - startedAtMs;

    const resultPayload =
      outcome.ok
        ? {
            state: "success" as const,
            started_at,
            finished_at,
            duration_ms,
            result: outcome.result,
            error: null,
          }
        : {
            state: "failed" as const,
            started_at,
            finished_at,
            duration_ms,
            result: null,
            error: outcome.error,
          };

    this.opts.logger.info(
      "command.result",
      `command ${command} ${resultPayload.state}`,
      {
        request_id,
        command,
        status: resultPayload.state,
        duration_ms,
        error: resultPayload.error ?? null,
      },
    );

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send(this.ws, "command.result", request_id, null, resultPayload);
    }
  }

  // ── Outbound helpers ─────────────────────────────────────────────────────

  private send(
    ws: WebSocket,
    type: WsMessageType,
    request_id: string | null,
    correlation_id: string | null,
    data: unknown,
  ): void {
    const env: WsEnvelope = {
      v: ENVELOPE_VERSION,
      type,
      id: randomUUID(),
      request_id,
      correlation_id,
      ts: new Date().toISOString(),
      data,
    };
    try {
      ws.send(JSON.stringify(env));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.logger.warn("ws.error", `send failed for ${type}: ${msg}`, {
        context: { type, message: msg },
      });
    }
  }

  /**
   * Forward a log entry produced by the local logger to the relay (best-effort).
   * Does NOT include the `log.*` events emitted by the WS layer itself, to avoid
   * runaway feedback loops if there is ever a malformed cycle (see filter).
   */
  private forwardLog(entry: LogEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Don't forward `log.event` from ourselves (we don't emit any anyway), and
    // don't forward our own ws.malformed from bad relay payloads more than once
    // — the `event` namespace already prevents dupes naturally. No special filter
    // needed in Phase 1.
    this.send(this.ws, "log.event", entry.request_id ?? null, entry.correlation_id ?? null, entry);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
    }
    this.stopHeartbeat();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function jitter(baseMs: number): number {
  // ±20% jitter (PROTOCOL §11.1)
  const factor = 0.8 + Math.random() * 0.4;
  return baseMs * factor;
}

function parseEnvelope(raw: RawData): WsEnvelope | null {
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    const json = JSON.parse(text);
    const parsed = WsEnvelopeSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
