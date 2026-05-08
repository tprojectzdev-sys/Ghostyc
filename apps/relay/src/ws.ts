// WebSocket server: /ws/agent, /ws/bridge, /ws/client. Handles handshake,
// heartbeats, command dispatch (incl. wake_pc orchestration), log forwarding.
// PROTOCOL.md §4 + §5 + §11.4 + §13.2.

import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  ENVELOPE_VERSION,
  HelloDataSchema,
  HeartbeatDataSchema,
  PROTOCOL_VERSION,
  WsEnvelopeSchema,
  type CommandRecord,
  type WsEnvelope,
  type WsMessageType,
  LogEventSchema,
} from "@ghostyc/protocol";
import { tokenEquals } from "./auth.js";
import type { Logger } from "./logger.js";
import type { State } from "./state.js";
import type { RelayConfig } from "./config.js";

interface AgentConn {
  ws: WebSocket;
  device_id: string;
  session_id: string;
  version: string;
}

interface BridgeConn {
  ws: WebSocket;
  device_id: string;
  session_id: string;
  version: string;
}

interface ClientConn {
  ws: WebSocket;
  session_id: string;
}

// Stage-2 wake watch entry. Created when the bridge confirms `packet_sent: true`
// for a wake_pc command. PROTOCOL §13.2.
interface WakeWatch {
  request_id: string;
  command: string;
  /** ISO timestamp when stage-1 (packet sent by bridge) finished. */
  stage1FinishedAt: string;
  /** Bridge's reported send result (packet_sent, packet_bytes, etc.). */
  stage1Result: Record<string, unknown>;
  /** Total ms from POST to wake watch resolution. timeout_ms - elapsed @ stage 2. */
  remainingMs: number;
  /** ISO timestamp when wake watch was armed. */
  watchStartedAt: string;
  /** Original submitted_at on the command record. */
  submittedAt: string;
  /** ISO timestamp when bridge command.dispatch was sent (rec.started_at). */
  startedAt: string | null;
  timer: NodeJS.Timeout;
}

export interface WsHub {
  agentConn(): AgentConn | null;
  bridgeConn(): BridgeConn | null;
  clientCount(): number;
  dispatchToAgent(rec: CommandRecord): { ok: boolean; reason?: string };
  dispatchToBridge(rec: CommandRecord, opts?: { wakeTimeoutMs?: number }): { ok: boolean; reason?: string };
  broadcastToClients(env: WsEnvelope): void;
  close(): Promise<void>;
}

export function startWsHub(opts: {
  logger: Logger;
  state: State;
  config: RelayConfig;
  attachToFastify: (path: string, handler: (ws: WebSocket, req: Headers) => void) => void;
}): WsHub {
  const { logger, state, config } = opts;

  let agent: AgentConn | null = null;
  let bridge: BridgeConn | null = null;
  const clients = new Set<ClientConn>();

  // wake_pc request_id → active watch. Resolved on agent online or timer.
  const wakeWatches = new Map<string, WakeWatch>();

  // Forward every relay log entry to all connected clients in real time.
  const unsubscribe = logger.subscribe((entry) => {
    if (clients.size === 0) return;
    const env = makeEnvelope("log.event", { request_id: entry.request_id ?? null, correlation_id: entry.correlation_id ?? null, data: entry });
    broadcastToClients(env);
  });

  // Heartbeat sweep. Runs every interval/2 so timeout detection lag is bounded.
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    const transitioned = state.sweepHeartbeats(now, config.GHOSTYC_HEARTBEAT_TIMEOUT_MS);
    for (const rec of transitioned) {
      logger.warn("heartbeat.timeout", `device ${rec.device_id} marked offline`, {
        device: rec.device_id,
        connection_state: "offline",
        context: { device_id: rec.device_id, role: rec.role },
      });
      logger.info("device.status_changed", `${rec.device_id}: online → offline`, {
        device: rec.device_id,
        context: { device_id: rec.device_id, role: rec.role, previous: "online", current: "offline", reason: "heartbeat_timeout" },
      });
      broadcastToClients(makeEnvelope("device.status", {
        data: {
          device_id: rec.device_id,
          role: rec.role,
          status: "offline",
          last_heartbeat: rec.last_heartbeat,
          reconnect_count: rec.reconnect_count,
          reason: "heartbeat_timeout",
        },
      }));

      if (agent && agent.device_id === rec.device_id) {
        try { agent.ws.terminate(); } catch { /* ignore */ }
        agent = null;
      }
      if (bridge && bridge.device_id === rec.device_id) {
        try { bridge.ws.terminate(); } catch { /* ignore */ }
        bridge = null;
      }
    }
  }, Math.max(2000, Math.floor(config.GHOSTYC_HEARTBEAT_MS / 2)));

  // ── Handlers ─────────────────────────────────────────────────────────────

  opts.attachToFastify("/ws/agent", (ws, _headers) => handleSocket(ws, "agent"));
  opts.attachToFastify("/ws/bridge", (ws, _headers) => handleSocket(ws, "bridge"));
  opts.attachToFastify("/ws/client", (ws, _headers) => handleSocket(ws, "client"));

  function handleSocket(ws: WebSocket, expectedRole: "agent" | "bridge" | "client"): void {
    let helloDone = false;
    const handshakeTimer = setTimeout(() => {
      if (!helloDone) {
        sendError(ws, "ws.protocol_violation", "no hello within 5s");
        ws.close(4400, "handshake timeout");
      }
    }, 5000);

    ws.on("message", (raw) => {
      const env = parseEnvelope(raw);
      if (!env) {
        logger.warn("ws.malformed", "dropped a malformed frame", {
          context: { expected_role: expectedRole },
        });
        return;
      }

      if (!helloDone) {
        if (env.type !== "hello") {
          sendError(ws, "ws.protocol_violation", "first frame must be hello");
          ws.close(4400, "expected hello");
          return;
        }
        const ok = handleHello(ws, env, expectedRole);
        if (ok) {
          helloDone = true;
          clearTimeout(handshakeTimer);
        }
        return;
      }

      switch (env.type) {
        case "heartbeat":
          if (expectedRole === "agent" || expectedRole === "bridge") handleExecutorHeartbeat(env, expectedRole);
          break;
        case "command.ack":
          if (expectedRole === "agent" || expectedRole === "bridge") handleExecutorAck(env, expectedRole);
          break;
        case "command.result":
          if (expectedRole === "agent") handleAgentResult(env);
          else if (expectedRole === "bridge") handleBridgeResult(env);
          break;
        case "log.event":
          if (expectedRole === "agent" || expectedRole === "bridge") handleExecutorLog(env, expectedRole);
          break;
        case "hello":
          sendError(ws, "ws.protocol_violation", "duplicate hello");
          break;
        default:
          logger.warn("ws.unknown_type", `unexpected type from ${expectedRole}: ${env.type}`, {
            context: { type: env.type, role: expectedRole },
          });
      }
    });

    ws.on("close", (code, reason) => {
      clearTimeout(handshakeTimer);
      const reasonStr = reason.toString();
      if (expectedRole === "agent" && agent && agent.ws === ws) {
        const now = new Date().toISOString();
        const rec = state.markOffline(agent.device_id, now, `ws closed code=${code} reason=${reasonStr || "n/a"}`);
        logger.info("ws.disconnected", `agent ${agent.device_id} disconnected (code=${code})`, {
          device: agent.device_id,
          connection_state: "offline",
          context: { code, reason: reasonStr },
        });
        if (rec) {
          logger.info("device.status_changed", `${rec.device_id}: online → offline`, {
            device: rec.device_id,
            context: { previous: "online", current: "offline", reason: "ws_closed" },
          });
          broadcastToClients(makeEnvelope("device.status", {
            data: {
              device_id: rec.device_id,
              role: rec.role,
              status: "offline",
              last_heartbeat: rec.last_heartbeat,
              reconnect_count: rec.reconnect_count,
              reason: "ws_closed",
            },
          }));
        }
        agent = null;
      } else if (expectedRole === "bridge" && bridge && bridge.ws === ws) {
        const now = new Date().toISOString();
        const rec = state.markOffline(bridge.device_id, now, `ws closed code=${code} reason=${reasonStr || "n/a"}`);
        logger.info("ws.disconnected", `bridge ${bridge.device_id} disconnected (code=${code})`, {
          device: bridge.device_id,
          connection_state: "offline",
          context: { code, reason: reasonStr },
        });
        if (rec) {
          logger.info("device.status_changed", `${rec.device_id}: online → offline`, {
            device: rec.device_id,
            context: { previous: "online", current: "offline", reason: "ws_closed" },
          });
          broadcastToClients(makeEnvelope("device.status", {
            data: {
              device_id: rec.device_id,
              role: rec.role,
              status: "offline",
              last_heartbeat: rec.last_heartbeat,
              reconnect_count: rec.reconnect_count,
              reason: "ws_closed",
            },
          }));
        }
        bridge = null;
      } else {
        for (const c of clients) {
          if (c.ws === ws) {
            clients.delete(c);
            logger.info("ws.disconnected", `client ${c.session_id} disconnected (code=${code})`, {
              context: { code, role: "client", session_id: c.session_id },
            });
            break;
          }
        }
      }
    });

    ws.on("error", (err) => {
      logger.error("ws.error", err.message, {
        context: { role: expectedRole },
      });
    });
  }

  function handleHello(ws: WebSocket, env: WsEnvelope, expectedRole: "agent" | "bridge" | "client"): boolean {
    const parsed = HelloDataSchema.safeParse(env.data);
    if (!parsed.success) {
      sendError(ws, "ws.protocol_violation", "invalid hello payload");
      ws.close(4400, "invalid hello");
      return false;
    }
    const data = parsed.data;

    if (data.role !== expectedRole) {
      sendError(ws, "ws.unauthorized", `role mismatch: connected to /ws/${expectedRole} but hello says role=${data.role}`);
      ws.close(4401, "role mismatch");
      return false;
    }

    let expectedToken: string;
    if (data.role === "agent") expectedToken = config.GHOSTYC_AGENT_TOKEN;
    else if (data.role === "bridge") expectedToken = config.GHOSTYC_BRIDGE_TOKEN;
    else expectedToken = config.GHOSTYC_CLIENT_TOKEN;

    if (!tokenEquals(data.token, expectedToken)) {
      logger.warn("auth.failed", `bad token on /ws/${expectedRole} for device_id=${data.device_id}`, {
        device: data.device_id,
      });
      sendError(ws, "auth.invalid_token", "invalid token");
      ws.close(4401, "auth failed");
      return false;
    }

    if (data.protocol_version !== PROTOCOL_VERSION) {
      logger.warn("protocol.mismatch", `client protocol_version=${data.protocol_version}, relay=${PROTOCOL_VERSION}`, {
        device: data.device_id,
        context: { client: data.protocol_version, relay: PROTOCOL_VERSION },
      });
      sendError(ws, "ws.protocol_violation", `protocol_version mismatch: relay=${PROTOCOL_VERSION}`);
      ws.close(4400, "protocol version mismatch");
      return false;
    }

    const session_id = randomUUID();
    const now = new Date().toISOString();

    if (data.role === "agent") {
      if (agent) { try { agent.ws.terminate(); } catch { /* ignore */ } }
      const { previous } = state.markOnline({
        role: "agent",
        device_id: data.device_id,
        version: data.version,
        now,
      });
      agent = { ws, device_id: data.device_id, session_id, version: data.version };

      sendEnvelope(ws, makeEnvelope("welcome", {
        data: {
          session_id,
          server_time: now,
          heartbeat_interval_ms: config.GHOSTYC_HEARTBEAT_MS,
          heartbeat_timeout_ms: config.GHOSTYC_HEARTBEAT_TIMEOUT_MS,
        },
      }));

      logger.info("auth.success", `agent ${data.device_id} authenticated`, {
        device: data.device_id,
        connection_state: "online",
        context: { session_id, version: data.version },
      });
      logger.info("ws.connected", `agent ${data.device_id} connected`, {
        device: data.device_id,
        connection_state: "online",
      });
      if (previous !== "online") {
        logger.info("device.status_changed", `${data.device_id}: ${previous} → online`, {
          device: data.device_id,
          context: { previous, current: "online", reason: "hello" },
        });
        broadcastToClients(makeEnvelope("device.status", {
          data: {
            device_id: data.device_id,
            role: "agent",
            status: "online",
            last_heartbeat: now,
            reconnect_count: state.getDevice(data.device_id)?.reconnect_count ?? 0,
            reason: "hello",
          },
        }));
        // Agent transitioned to online → resolve any pending wake watches.
        resolveWakeWatchesAgentOnline(now);
      }
      return true;
    }

    if (data.role === "bridge") {
      if (bridge) { try { bridge.ws.terminate(); } catch { /* ignore */ } }
      const { previous } = state.markOnline({
        role: "bridge",
        device_id: data.device_id,
        version: data.version,
        now,
      });
      bridge = { ws, device_id: data.device_id, session_id, version: data.version };

      sendEnvelope(ws, makeEnvelope("welcome", {
        data: {
          session_id,
          server_time: now,
          heartbeat_interval_ms: config.GHOSTYC_HEARTBEAT_MS,
          heartbeat_timeout_ms: config.GHOSTYC_HEARTBEAT_TIMEOUT_MS,
        },
      }));

      logger.info("auth.success", `bridge ${data.device_id} authenticated`, {
        device: data.device_id,
        connection_state: "online",
        context: { session_id, version: data.version },
      });
      logger.info("ws.connected", `bridge ${data.device_id} connected`, {
        device: data.device_id,
        connection_state: "online",
      });
      if (previous !== "online") {
        logger.info("device.status_changed", `${data.device_id}: ${previous} → online`, {
          device: data.device_id,
          context: { previous, current: "online", reason: "hello" },
        });
        broadcastToClients(makeEnvelope("device.status", {
          data: {
            device_id: data.device_id,
            role: "bridge",
            status: "online",
            last_heartbeat: now,
            reconnect_count: state.getDevice(data.device_id)?.reconnect_count ?? 0,
            reason: "hello",
          },
        }));
      }
      return true;
    }

    // role === "client"
    clients.add({ ws, session_id });
    sendEnvelope(ws, makeEnvelope("welcome", {
      data: {
        session_id,
        server_time: now,
        heartbeat_interval_ms: config.GHOSTYC_HEARTBEAT_MS,
        heartbeat_timeout_ms: config.GHOSTYC_HEARTBEAT_TIMEOUT_MS,
      },
    }));
    logger.info("auth.success", `client ${session_id} authenticated`, {
      context: { role: "client", session_id },
    });
    logger.info("ws.connected", `client ${session_id} connected`, {
      context: { role: "client", session_id },
    });
    return true;
  }

  function handleExecutorHeartbeat(env: WsEnvelope, role: "agent" | "bridge"): void {
    const conn = role === "agent" ? agent : bridge;
    if (!conn) return;
    const parsed = HeartbeatDataSchema.safeParse(env.data);
    if (!parsed.success) {
      logger.warn("ws.malformed", "bad heartbeat payload", {
        device: conn.device_id,
        context: { issues: parsed.error.issues.map((i) => i.message) },
      });
      return;
    }
    const now = new Date().toISOString();
    state.recordHeartbeat(conn.device_id, now, parsed.data.version);
  }

  function handleExecutorAck(env: WsEnvelope, role: "agent" | "bridge"): void {
    if (!env.request_id) return;
    const rec = state.getCommand(env.request_id);
    if (!rec || rec.state !== "accepted") return;
    rec.state = "running";
    rec.started_at = (env.data as { started_at?: string } | null)?.started_at ?? new Date().toISOString();
    const conn = role === "agent" ? agent : bridge;
    logger.info("command.acked", `${role} acked ${rec.command}`, {
      device: conn?.device_id,
      command: rec.command,
      request_id: rec.request_id,
      status: "running",
    });
  }

  function handleAgentResult(env: WsEnvelope): void {
    if (!env.request_id) return;
    const rec = state.getCommand(env.request_id);
    if (!rec) {
      logger.warn("command.result", "result for unknown request_id, dropping", {
        request_id: env.request_id,
      });
      return;
    }
    const data = env.data as {
      state?: "success" | "failed" | "timeout" | "target_offline";
      started_at?: string;
      finished_at?: string;
      duration_ms?: number;
      result?: unknown;
      error?: CommandRecord["error"];
    } | null;

    const finalState = data?.state ?? "failed";
    const finished_at = data?.finished_at ?? new Date().toISOString();
    if (rec.state === "timeout") {
      logger.warn("command.result", `late result after timeout for ${rec.command}`, {
        device: agent?.device_id,
        command: rec.command,
        request_id: rec.request_id,
        status: finalState,
        duration_ms: data?.duration_ms ?? null,
      });
      return;
    }
    rec.state = finalState;
    rec.started_at = rec.started_at ?? data?.started_at ?? finished_at;
    rec.finished_at = finished_at;
    rec.result = data?.result ?? null;
    rec.error = data?.error ?? null;

    logger.info("command.result", `command ${rec.command} ${finalState}`, {
      device: agent?.device_id,
      command: rec.command,
      request_id: rec.request_id,
      status: finalState,
      duration_ms: data?.duration_ms ?? null,
      error: rec.error,
    });

    broadcastToClients(makeEnvelope("command.result", {
      request_id: rec.request_id,
      data: {
        state: finalState,
        started_at: rec.started_at,
        finished_at,
        duration_ms: data?.duration_ms ?? null,
        result: rec.result,
        error: rec.error,
      },
    }));
  }

  function handleBridgeResult(env: WsEnvelope): void {
    if (!env.request_id) return;
    const rec = state.getCommand(env.request_id);
    if (!rec) {
      logger.warn("command.result", "result for unknown request_id, dropping", {
        request_id: env.request_id,
      });
      return;
    }
    const data = env.data as {
      state?: "success" | "failed" | "timeout" | "target_offline";
      started_at?: string;
      finished_at?: string;
      duration_ms?: number;
      result?: Record<string, unknown> | null;
      error?: CommandRecord["error"];
    } | null;
    const finalState = data?.state ?? "failed";
    const finished_at = data?.finished_at ?? new Date().toISOString();

    if (rec.state === "timeout") {
      logger.warn("command.result", `late result after timeout for ${rec.command}`, {
        device: bridge?.device_id,
        command: rec.command,
        request_id: rec.request_id,
        status: finalState,
        duration_ms: data?.duration_ms ?? null,
      });
      return;
    }

    // Special case: wake_pc has a two-stage lifecycle. Stage 1 is the bridge
    // confirming the magic packet was emitted. The relay does NOT forward this
    // to clients yet — it starts a "wake watch" and waits for the agent to
    // come online (PROTOCOL §13.2).
    if (rec.command === "wake_pc" && finalState === "success") {
      const stage1Result = (data?.result ?? {}) as Record<string, unknown>;
      const watch = wakeWatches.get(rec.request_id);
      // The watch entry is pre-armed by dispatchToBridge with its timer; stage 1
      // updates the timer with remaining budget and starts the watch.
      const startedAtMs = rec.started_at ? Date.parse(rec.started_at) : Date.parse(rec.submitted_at);
      const stage1Ms = Date.parse(finished_at) - startedAtMs;
      const total = watch?.remainingMs ?? 120000;
      const remaining = Math.max(1000, total - Math.max(0, stage1Ms));
      const watchStartedAt = new Date().toISOString();

      // Persist the bridge's success on the bridge device record.
      if (bridge) state.recordWakeAttempt(bridge.device_id, finished_at);

      logger.info("wake.watching", `wake watch started for ${rec.request_id}`, {
        device: bridge?.device_id,
        command: rec.command,
        request_id: rec.request_id,
        correlation_id: rec.request_id,
        status: "running",
        context: {
          stage1: stage1Result,
          stage1_duration_ms: stage1Ms,
          watch_timeout_ms: remaining,
        },
      });

      if (watch) clearTimeout(watch.timer);
      const newTimer = setTimeout(() => resolveWakeWatch(rec.request_id, "timeout"), remaining);
      const watchEntry: WakeWatch = {
        request_id: rec.request_id,
        command: rec.command,
        stage1FinishedAt: finished_at,
        stage1Result,
        remainingMs: remaining,
        watchStartedAt,
        submittedAt: rec.submitted_at,
        startedAt: rec.started_at,
        timer: newTimer,
      };
      wakeWatches.set(rec.request_id, watchEntry);
      // Keep rec.state at "running" (stage 2 in flight). Stash partial result.
      rec.result = {
        ...stage1Result,
        agent_came_online: false,
        agent_online_at: null,
        wait_duration_ms: 0,
      };
      return;
    }

    // wake_pc stage 1 failed → forward immediately, no watch.
    if (rec.command === "wake_pc" && finalState !== "success") {
      const watch = wakeWatches.get(rec.request_id);
      if (watch) {
        clearTimeout(watch.timer);
        wakeWatches.delete(rec.request_id);
      }
    }

    // Default path (status command on bridge, or wake_pc failure).
    rec.state = finalState;
    rec.started_at = rec.started_at ?? data?.started_at ?? finished_at;
    rec.finished_at = finished_at;
    rec.result = data?.result ?? null;
    rec.error = data?.error ?? null;

    logger.info("command.result", `command ${rec.command} ${finalState}`, {
      device: bridge?.device_id,
      command: rec.command,
      request_id: rec.request_id,
      status: finalState,
      duration_ms: data?.duration_ms ?? null,
      error: rec.error,
    });

    broadcastToClients(makeEnvelope("command.result", {
      request_id: rec.request_id,
      data: {
        state: finalState,
        started_at: rec.started_at,
        finished_at,
        duration_ms: data?.duration_ms ?? null,
        result: rec.result,
        error: rec.error,
      },
    }));
  }

  function handleExecutorLog(env: WsEnvelope, role: "agent" | "bridge"): void {
    const parsed = LogEventSchema.safeParse(env.data);
    if (!parsed.success) {
      const conn = role === "agent" ? agent : bridge;
      logger.warn("ws.malformed", "bad log.event payload", {
        device: conn?.device_id,
        context: { issues: parsed.error.issues.map((i) => i.message) },
      });
      return;
    }
    logger.ingest(parsed.data);
  }

  // ── Wake watch resolution ────────────────────────────────────────────────

  function resolveWakeWatchesAgentOnline(at: string): void {
    if (wakeWatches.size === 0) return;
    const ids = Array.from(wakeWatches.keys());
    for (const id of ids) {
      resolveWakeWatch(id, "success", at);
    }
  }

  function resolveWakeWatch(
    request_id: string,
    outcome: "success" | "timeout",
    agentOnlineAt?: string,
  ): void {
    const watch = wakeWatches.get(request_id);
    if (!watch) return;
    wakeWatches.delete(request_id);
    clearTimeout(watch.timer);

    const rec = state.getCommand(request_id);
    if (!rec) return;
    if (
      rec.state === "success" ||
      rec.state === "failed" ||
      rec.state === "timeout" ||
      rec.state === "target_offline" ||
      rec.state === "rejected"
    ) {
      // Already terminal, nothing to broadcast.
      return;
    }

    const finished_at = new Date().toISOString();
    const totalDuration = Date.parse(finished_at) - Date.parse(rec.submitted_at);
    const waitDuration = Date.parse(finished_at) - Date.parse(watch.watchStartedAt);

    const errorObj =
      outcome === "timeout"
        ? {
            code: "wake.agent_no_show",
            message: "WoL packet sent but agent did not reconnect within timeout_ms",
            at: finished_at,
            request_id,
          }
        : null;

    const finalState = outcome === "success" ? "success" : "timeout";
    const result = {
      ...watch.stage1Result,
      agent_came_online: outcome === "success",
      agent_online_at: outcome === "success" ? (agentOnlineAt ?? finished_at) : null,
      wait_duration_ms: Math.max(0, waitDuration),
    };

    rec.state = finalState;
    rec.finished_at = finished_at;
    rec.result = result;
    rec.error = errorObj;

    logger.info("wake.watch_resolved", `wake watch resolved: ${finalState}`, {
      device: agent?.device_id,
      command: rec.command,
      request_id,
      correlation_id: request_id,
      status: finalState,
      duration_ms: totalDuration,
      error: errorObj,
      context: {
        agent_came_online: outcome === "success",
        wait_duration_ms: result.wait_duration_ms,
      },
    });

    logger.info("command.result", `command ${rec.command} ${finalState}`, {
      device: bridge?.device_id ?? agent?.device_id,
      command: rec.command,
      request_id,
      status: finalState,
      duration_ms: totalDuration,
      error: errorObj,
    });

    broadcastToClients(makeEnvelope("command.result", {
      request_id,
      data: {
        state: finalState,
        started_at: rec.started_at,
        finished_at,
        duration_ms: totalDuration,
        result,
        error: errorObj,
      },
    }));
  }

  // ── Public hub API ───────────────────────────────────────────────────────

  function dispatchToAgent(rec: CommandRecord): { ok: boolean; reason?: string } {
    if (!agent) return { ok: false, reason: "agent_not_connected" };
    const env: WsEnvelope = makeEnvelope("command.dispatch", {
      request_id: rec.request_id,
      data: {
        command: rec.command,
        args: (rec as unknown as { args?: unknown }).args ?? {},
        timeout_ms: (rec as unknown as { timeout_ms?: number }).timeout_ms ?? 10000,
        issued_by: "client",
        issued_at: rec.submitted_at,
      },
    });
    try {
      agent.ws.send(JSON.stringify(env));
      state.setLastCommand(agent.device_id, rec.request_id);
      logger.info("command.dispatched", `dispatched ${rec.command} to ${agent.device_id}`, {
        device: agent.device_id,
        command: rec.command,
        request_id: rec.request_id,
        status: "running",
      });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("command.dispatched", `failed to send to agent: ${msg}`, {
        device: agent.device_id,
        command: rec.command,
        request_id: rec.request_id,
        error: { code: "ws.send_failed", message: msg, at: new Date().toISOString(), request_id: rec.request_id },
      });
      return { ok: false, reason: "send_failed" };
    }
  }

  function dispatchToBridge(
    rec: CommandRecord,
    dispatchOpts?: { wakeTimeoutMs?: number },
  ): { ok: boolean; reason?: string } {
    if (!bridge) return { ok: false, reason: "bridge_not_connected" };
    const env: WsEnvelope = makeEnvelope("command.dispatch", {
      request_id: rec.request_id,
      data: {
        command: rec.command,
        args: (rec as unknown as { args?: unknown }).args ?? {},
        timeout_ms: (rec as unknown as { timeout_ms?: number }).timeout_ms ?? 5000,
        issued_by: "client",
        issued_at: rec.submitted_at,
      },
    });
    try {
      bridge.ws.send(JSON.stringify(env));
      state.setLastCommand(bridge.device_id, rec.request_id);
      logger.info("command.dispatched", `dispatched ${rec.command} to ${bridge.device_id}`, {
        device: bridge.device_id,
        command: rec.command,
        request_id: rec.request_id,
        status: "running",
      });

      // For wake_pc, pre-arm a placeholder watch so the http layer doesn't have
      // to know about wake watches. The bridge's stage 1 result will replace
      // this timer. If stage 1 never arrives, this timer fires the timeout.
      if (rec.command === "wake_pc") {
        const total = dispatchOpts?.wakeTimeoutMs ?? 120000;
        const timer = setTimeout(() => resolveWakeWatch(rec.request_id, "timeout"), total);
        wakeWatches.set(rec.request_id, {
          request_id: rec.request_id,
          command: rec.command,
          stage1FinishedAt: "",
          stage1Result: { packet_sent: false, packet_bytes: 0 },
          remainingMs: total,
          watchStartedAt: new Date().toISOString(),
          submittedAt: rec.submitted_at,
          startedAt: rec.started_at,
          timer,
        });
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("command.dispatched", `failed to send to bridge: ${msg}`, {
        device: bridge.device_id,
        command: rec.command,
        request_id: rec.request_id,
        error: { code: "ws.send_failed", message: msg, at: new Date().toISOString(), request_id: rec.request_id },
      });
      return { ok: false, reason: "send_failed" };
    }
  }

  function broadcastToClients(env: WsEnvelope): void {
    const payload = JSON.stringify(env);
    for (const c of clients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        try {
          c.ws.send(payload);
        } catch {
          // close handler will clean up
        }
      }
    }
  }

  return {
    agentConn: () => agent,
    bridgeConn: () => bridge,
    clientCount: () => clients.size,
    dispatchToAgent,
    dispatchToBridge,
    broadcastToClients,
    async close() {
      clearInterval(sweepInterval);
      unsubscribe();
      for (const watch of wakeWatches.values()) clearTimeout(watch.timer);
      wakeWatches.clear();
      if (agent) { try { agent.ws.close(1001, "relay shutting down"); } catch { /* ignore */ } }
      if (bridge) { try { bridge.ws.close(1001, "relay shutting down"); } catch { /* ignore */ } }
      for (const c of clients) {
        try { c.ws.close(1001, "relay shutting down"); } catch { /* ignore */ }
      }
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseEnvelope(raw: RawData): WsEnvelope | null {
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    const json = JSON.parse(text);
    const parsed = WsEnvelopeSchema.safeParse(json);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function makeEnvelope(
  type: WsMessageType,
  opts: { request_id?: string | null; correlation_id?: string | null; data: unknown },
): WsEnvelope {
  return {
    v: ENVELOPE_VERSION,
    type,
    id: randomUUID(),
    request_id: opts.request_id ?? null,
    correlation_id: opts.correlation_id ?? null,
    ts: new Date().toISOString(),
    data: opts.data,
  };
}

function sendEnvelope(ws: WebSocket, env: WsEnvelope): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(env));
  } catch {
    // ignore
  }
}

function sendError(ws: WebSocket, code: string, message: string): void {
  sendEnvelope(ws, {
    v: ENVELOPE_VERSION,
    type: "error",
    id: randomUUID(),
    request_id: null,
    correlation_id: null,
    ts: new Date().toISOString(),
    data: { code, message, at: new Date().toISOString() },
  });
}

export { WebSocketServer };
