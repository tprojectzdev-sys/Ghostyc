// REST routes — PROTOCOL.md §3. Implemented with Fastify.

import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import {
  AgentCommandNameSchema,
  BridgeCommandNameSchema,
  PostCommandRequestSchema,
  PROTOCOL_VERSION,
  type CommandRecord,
  type DiagnosticsSnapshot,
} from "@ghostyc/protocol";
import { LoginRateLimiter, bearerFromHeader, tokenEquals } from "./auth.js";
import type { Logger } from "./logger.js";
import type { State } from "./state.js";
import type { RelayConfig } from "./config.js";
import type { WsHub } from "./ws.js";

const KNOWN_AGENT_COMMANDS = new Set<string>([
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

// PROTOCOL §13.2: bridge commands implemented in Phase 5.
const KNOWN_BRIDGE_COMMANDS = new Set<string>(["wake_pc", "status"]);

const DEFAULT_TIMEOUTS_AGENT: Record<string, number> = {
  status: 5000,
  lock: 5000,
  sleep: 5000,
  shutdown: 5000,
  restart: 5000,
  open_app: 10000,
  open_website: 5000,
  list_processes: 10000,
  kill_process: 10000,
  screenshot: 15000,
};

// Bridge defaults (and clamps) per PROTOCOL §13.2. wake_pc has a much wider
// total budget because Stage 2 must outlast a cold boot.
const DEFAULT_TIMEOUTS_BRIDGE: Record<string, number> = {
  status: 5000,
  wake_pc: 120000,
};

const TIMEOUT_CLAMPS_BRIDGE: Record<string, [number, number]> = {
  status: [1000, 30000],
  wake_pc: [10000, 300000],
};

function computeTimeoutMs(
  target: "agent" | "bridge",
  command: string,
  requested: number | undefined,
): number {
  if (target === "agent") {
    return requested ?? DEFAULT_TIMEOUTS_AGENT[command] ?? 10000;
  }
  const def = DEFAULT_TIMEOUTS_BRIDGE[command] ?? 5000;
  const clamp = TIMEOUT_CLAMPS_BRIDGE[command];
  const value = requested ?? def;
  if (clamp) {
    const [min, max] = clamp;
    return Math.max(min, Math.min(max, value));
  }
  return value;
}

export async function buildHttpServer(opts: {
  logger: Logger;
  state: State;
  config: RelayConfig;
  getHub: () => WsHub;
}): Promise<FastifyInstance> {
  const { logger, state, config, getHub } = opts;

  const fastify = Fastify({
    // Use our own logging path.
    logger: false,
    bodyLimit: 1024 * 1024, // 1 MB
  });

  await fastify.register(cors, {
    origin: true, // permissive in dev; tighten in Phase 6 if needed
    credentials: false,
  });

  const loginLimiter = new LoginRateLimiter();

  // Per-request request_id: respect X-Request-Id if a UUID, else generate.
  fastify.addHook("onRequest", async (req) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && /^[0-9a-f-]{8,}$/i.test(incoming)
      ? incoming
      : randomUUID();
    (req as FastifyRequest & { requestId: string }).requestId = id;
  });

  function reqId(req: FastifyRequest): string {
    return (req as FastifyRequest & { requestId: string }).requestId;
  }

  // ── Auth middleware (per-route guard) ────────────────────────────────────

  function requireClient(req: FastifyRequest): { ok: true } | { ok: false; code: string; message: string } {
    const provided = bearerFromHeader(req.headers["authorization"] as string | undefined);
    if (!provided) {
      return { ok: false, code: "auth.missing", message: "Authorization header missing" };
    }
    if (!tokenEquals(provided, config.GHOSTYC_CLIENT_TOKEN)) {
      return { ok: false, code: "auth.invalid_token", message: "invalid client token" };
    }
    return { ok: true };
  }

  // ── Routes ───────────────────────────────────────────────────────────────

  fastify.get("/health", async (_req, _reply) => {
    return {
      status: "ok",
      uptime_s: state.uptimeSeconds(),
      protocol_version: PROTOCOL_VERSION,
    };
  });

  fastify.post("/auth/login", async (req, reply) => {
    const now = Date.now();
    if (!loginLimiter.hit(now)) {
      logger.warn("auth.failed", "login rate limited", { request_id: reqId(req) });
      return reply.code(429).send({
        request_id: reqId(req),
        error: { code: "auth.rate_limited", message: "too many attempts; try again in a minute", at: new Date().toISOString(), request_id: reqId(req) },
      });
    }
    const body = req.body as { password?: string } | undefined;
    if (!body || typeof body.password !== "string") {
      return reply.code(400).send({
        request_id: reqId(req),
        error: { code: "request.malformed", message: "missing 'password' string", at: new Date().toISOString(), request_id: reqId(req) },
      });
    }
    if (!tokenEquals(body.password, config.GHOSTYC_ADMIN_PASSWORD)) {
      logger.warn("auth.failed", "wrong admin password", { request_id: reqId(req) });
      return reply.code(401).send({
        request_id: reqId(req),
        error: { code: "auth.invalid_password", message: "invalid password", at: new Date().toISOString(), request_id: reqId(req) },
      });
    }
    logger.info("auth.success", "admin password accepted", { request_id: reqId(req) });
    return {
      token: config.GHOSTYC_CLIENT_TOKEN,
      expires_at: null,
      request_id: reqId(req),
    };
  });

  fastify.get("/auth/whoami", async (req, reply) => {
    const auth = requireClient(req);
    if (!auth.ok) return sendAuthError(reply, req, auth);
    return {
      role: "client",
      server_time: new Date().toISOString(),
      protocol_version: PROTOCOL_VERSION,
      request_id: reqId(req),
    };
  });

  fastify.get("/devices", async (req, reply) => {
    const auth = requireClient(req);
    if (!auth.ok) return sendAuthError(reply, req, auth);
    const devices = state
      .listDevices()
      .map((d) => ({
        device_id: d.device_id,
        role: d.role,
        status: d.status,
        last_heartbeat: d.last_heartbeat,
        connected_since: d.connected_since,
        reconnect_count: d.reconnect_count,
        version: d.version,
      }));
    return { devices, request_id: reqId(req) };
  });

  fastify.post("/commands", async (req, reply) => {
    const auth = requireClient(req);
    if (!auth.ok) return sendAuthError(reply, req, auth);

    const parsed = PostCommandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      logger.warn("command.rejected", `invalid args: ${reason}`, { request_id: reqId(req) });
      return reply.code(400).send({
        request_id: reqId(req),
        status: "rejected",
        reason: "invalid_args",
        error: {
          code: "request.invalid_args",
          message: reason,
          at: new Date().toISOString(),
          request_id: reqId(req),
        },
      });
    }

    const body = parsed.data;
    const request_id = body.request_id ?? reqId(req);

    // Validate command name against the authoritative dispatch tables.
    const known =
      body.target === "agent"
        ? KNOWN_AGENT_COMMANDS.has(body.command)
        : KNOWN_BRIDGE_COMMANDS.has(body.command);

    if (!known) {
      logger.warn("command.rejected", `unknown command: ${body.target}/${body.command}`, { request_id });
      return reply.code(400).send({
        request_id,
        status: "rejected",
        reason: "unknown_command",
        error: {
          code: "command.unknown",
          message: `command '${body.command}' is not implemented for target '${body.target}' in this build`,
          at: new Date().toISOString(),
          request_id,
        },
      });
    }

    const hub = getHub();
    const targetConn = body.target === "agent" ? hub.agentConn() : hub.bridgeConn();
    if (!targetConn) {
      logger.warn("command.rejected", `target_offline: ${body.target} not connected`, {
        request_id,
        command: body.command,
      });
      return reply.code(409).send({
        request_id,
        status: "rejected",
        reason: "target_offline",
        error: {
          code: "command.target_offline",
          message: `${body.target} is offline`,
          at: new Date().toISOString(),
          request_id,
        },
      });
    }

    // Typed name validation against the per-target enum.
    const nameOk =
      body.target === "agent"
        ? AgentCommandNameSchema.safeParse(body.command).success
        : BridgeCommandNameSchema.safeParse(body.command).success;
    if (!nameOk) {
      return reply.code(400).send({
        request_id,
        status: "rejected",
        reason: "unknown_command",
        error: { code: "command.unknown", message: "schema mismatch", at: new Date().toISOString(), request_id },
      });
    }

    const submitted_at = new Date().toISOString();
    const timeout_ms = computeTimeoutMs(body.target, body.command, body.timeout_ms);
    const rec: CommandRecord & { args: Record<string, unknown>; timeout_ms: number } = {
      request_id,
      target: body.target,
      command: body.command,
      state: "accepted",
      submitted_at,
      started_at: null,
      finished_at: null,
      result: null,
      error: null,
      args: body.args ?? {},
      timeout_ms,
    };
    state.saveCommand(rec);

    logger.info("command.received", `${body.command} (request_id=${request_id})`, {
      device: targetConn.device_id,
      command: body.command,
      request_id,
      status: "accepted",
    });

    const dispatch =
      body.target === "agent"
        ? hub.dispatchToAgent(rec)
        : hub.dispatchToBridge(rec, body.command === "wake_pc" ? { wakeTimeoutMs: timeout_ms } : undefined);
    if (!dispatch.ok) {
      state.updateCommand(request_id, {
        state: "failed",
        finished_at: new Date().toISOString(),
        error: {
          code: "command.failed",
          message: `dispatch failed: ${dispatch.reason ?? "unknown"}`,
          at: new Date().toISOString(),
          request_id,
        },
      });
      return reply.code(409).send({
        request_id,
        status: "rejected",
        reason: dispatch.reason ?? "dispatch_failed",
        error: {
          code: "command.target_offline",
          message: dispatch.reason ?? "dispatch failed",
          at: new Date().toISOString(),
          request_id,
        },
      });
    }

    // Arm command timeout — except for wake_pc, whose two-stage lifecycle is
    // owned by the WS hub's wake watch (PROTOCOL §13.2).
    const isWakePc = body.target === "bridge" && body.command === "wake_pc";
    if (!isWakePc) {
      setTimeout(() => {
        const cur = state.getCommand(request_id);
        if (!cur) return;
        if (
          cur.state === "success" ||
          cur.state === "failed" ||
          cur.state === "timeout" ||
          cur.state === "target_offline" ||
          cur.state === "rejected"
        ) {
          return;
        }
        state.updateCommand(request_id, {
          state: "timeout",
          finished_at: new Date().toISOString(),
          error: {
            code: "command.timeout",
            message: `no result within ${timeout_ms}ms`,
            at: new Date().toISOString(),
            request_id,
          },
        });
        logger.warn("command.timeout", `${body.command} timed out after ${timeout_ms}ms`, {
          device: targetConn.device_id,
          command: body.command,
          request_id,
          status: "timeout",
          duration_ms: timeout_ms,
        });
        hub.broadcastToClients({
          v: 1,
          type: "command.result",
          id: randomUUID(),
          request_id,
          correlation_id: null,
          ts: new Date().toISOString(),
          data: {
            state: "timeout",
            started_at: cur.started_at,
            finished_at: new Date().toISOString(),
            duration_ms: timeout_ms,
            result: null,
            error: {
              code: "command.timeout",
              message: `no result within ${timeout_ms}ms`,
              at: new Date().toISOString(),
              request_id,
            },
          },
        });
      }, timeout_ms);
    }

    return reply.code(202).send({
      request_id,
      status: "accepted",
      submitted_at,
    });
  });

  fastify.get<{ Params: { request_id: string } }>("/commands/:request_id", async (req, reply) => {
    const auth = requireClient(req);
    if (!auth.ok) return sendAuthError(reply, req, auth);
    const rec = state.getCommand(req.params.request_id);
    if (!rec) {
      return reply.code(404).send({
        request_id: reqId(req),
        error: {
          code: "request.malformed",
          message: "no such request_id",
          at: new Date().toISOString(),
          request_id: reqId(req),
        },
      });
    }
    return {
      request_id: rec.request_id,
      state: rec.state,
      submitted_at: rec.submitted_at,
      started_at: rec.started_at,
      finished_at: rec.finished_at,
      result: rec.result,
      error: rec.error,
    };
  });

  fastify.get<{ Querystring: { limit?: string; since?: string; service?: string; request_id?: string } }>(
    "/logs/recent",
    async (req, reply) => {
      const auth = requireClient(req);
      if (!auth.ok) return sendAuthError(reply, req, auth);
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const logs = logger.recent({
        limit: Number.isFinite(limit) ? limit : 100,
        since: req.query.since,
        service: req.query.service,
        request_id: req.query.request_id,
      });
      return { logs, request_id: reqId(req) };
    },
  );

  fastify.get("/diagnostics", async (req, reply) => {
    const auth = requireClient(req);
    if (!auth.ok) return sendAuthError(reply, req, auth);

    const agentRec = state.getDeviceByRole("agent");
    const bridgeRec = state.getDeviceByRole("bridge");
    const lastCmd = agentRec ? state.lastCommandFor(agentRec.device_id) : null;
    const ringSnap = logger.ringSnapshot();

    const snap: DiagnosticsSnapshot = {
      relay: {
        status: "ok",
        uptime_s: state.uptimeSeconds(),
        protocol_version: PROTOCOL_VERSION,
        ws_clients_connected: getHub().clientCount(),
        log_buffer_size: ringSnap.size,
        log_buffer_capacity: ringSnap.capacity,
        persistent_logs: {
          enabled: logger.isFileSinkEnabled(),
          dir: logger.fileSinkDir(),
        },
      },
      agent: agentRec
        ? {
            device_id: agentRec.device_id,
            role: agentRec.role,
            status: agentRec.status,
            last_heartbeat: agentRec.last_heartbeat,
            connected_since: agentRec.connected_since,
            reconnect_count: agentRec.reconnect_count,
            version: agentRec.version,
            last_command: lastCmd
              ? {
                  request_id: lastCmd.request_id,
                  command: lastCmd.command,
                  state: lastCmd.state,
                  finished_at: lastCmd.finished_at,
                }
              : null,
            last_error: agentRec.last_error,
          }
        : null,
      bridge: bridgeRec
        ? {
            device_id: bridgeRec.device_id,
            role: bridgeRec.role,
            status: bridgeRec.status,
            last_heartbeat: bridgeRec.last_heartbeat,
            connected_since: bridgeRec.connected_since,
            reconnect_count: bridgeRec.reconnect_count,
            version: bridgeRec.version,
            last_wake_attempt: bridgeRec.last_wake_attempt,
            last_error: bridgeRec.last_error,
          }
        : null,
      auth: {
        client_token_present: Boolean(config.GHOSTYC_CLIENT_TOKEN),
        agent_token_present: Boolean(config.GHOSTYC_AGENT_TOKEN),
        bridge_token_present: Boolean(config.GHOSTYC_BRIDGE_TOKEN),
      },
      request_id: reqId(req),
    };
    return snap;
  });

  // ── 404 fallback ─────────────────────────────────────────────────────────

  fastify.setNotFoundHandler((req, reply) => {
    return reply.code(404).send({
      request_id: reqId(req),
      error: {
        code: "request.malformed",
        message: `no such route: ${req.method} ${req.url}`,
        at: new Date().toISOString(),
        request_id: reqId(req),
      },
    });
  });

  return fastify;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function sendAuthError(
    reply: import("fastify").FastifyReply,
    req: FastifyRequest,
    err: { ok: false; code: string; message: string },
  ) {
    return reply.code(401).send({
      request_id: reqId(req),
      error: {
        code: err.code,
        message: err.message,
        at: new Date().toISOString(),
        request_id: reqId(req),
      },
    });
  }
}
