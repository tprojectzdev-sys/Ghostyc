// Relay entrypoint. Boots config, logger, state, HTTP, and the WS hub.

import "dotenv/config";
import { WebSocketServer, type WebSocket } from "ws";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { State } from "./state.js";
import { buildHttpServer } from "./http.js";
import { startWsHub } from "./ws.js";

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  if (!cfg.ok) {
    // Log to stdout in the structured shape (we don't have a Logger yet).
    const entry = {
      timestamp: new Date().toISOString(),
      service: "relay",
      device: "relay",
      level: "error",
      event: "config.invalid",
      message: "required environment variables missing or invalid",
      request_id: null,
      correlation_id: null,
      context: {
        missing_keys: cfg.missing,
        invalid: cfg.invalid,
      },
    };
    process.stdout.write(JSON.stringify(entry) + "\n");
    process.exit(2);
  }

  const config = cfg.config;
  const logger = new Logger({
    device: "relay",
    bufferSize: config.GHOSTYC_LOG_BUFFER_SIZE,
  });

  const sink = logger.enableFileSink(config.GHOSTYC_LOG_DIR);
  if (sink.enabled) {
    logger.info("log.persistent_enabled", `relay JSONL logs at ${sink.dir}/relay.log`, {
      context: { dir: sink.dir, rotation_mb: 5, keep: 5 },
    });
  } else {
    logger.info("log.ephemeral", "relay logs are ephemeral (in-memory ring buffer only)", {
      context: { reason: sink.reason ?? "GHOSTYC_LOG_DIR unset" },
    });
  }

  const state = new State();
  // Devices are NOT pre-seeded. Until the agent or bridge actually connects,
  // /devices returns an empty list and /diagnostics shows agent/bridge as null.
  // This is intentional per the no-fake-data rule (PROTOCOL §6.3).

  // Build Fastify server.
  let hubRef: ReturnType<typeof startWsHub> | null = null;
  const fastify = await buildHttpServer({
    logger,
    state,
    config,
    getHub: () => {
      if (!hubRef) throw new Error("ws hub not initialized");
      return hubRef;
    },
  });

  // Attach raw WebSocket server (noServer mode) and route upgrades manually.
  const wssAgent = new WebSocketServer({ noServer: true });
  const wssBridge = new WebSocketServer({ noServer: true });
  const wssClient = new WebSocketServer({ noServer: true });

  type UpgradeHandler = (ws: WebSocket) => void;
  const handlers = new Map<string, UpgradeHandler>();

  hubRef = startWsHub({
    logger,
    state,
    config,
    attachToFastify: (path, handler) => {
      handlers.set(path, (ws) => handler(ws, new Headers()));
    },
  });

  fastify.server.on("upgrade", (request, socket, head) => {
    const url = request.url ?? "";
    if (url === "/ws/agent") {
      wssAgent.handleUpgrade(request, socket, head, (ws) => {
        const h = handlers.get("/ws/agent");
        if (h) h(ws);
        else ws.close(1011, "no handler");
      });
    } else if (url === "/ws/bridge") {
      wssBridge.handleUpgrade(request, socket, head, (ws) => {
        const h = handlers.get("/ws/bridge");
        if (h) h(ws);
        else ws.close(1011, "no handler");
      });
    } else if (url === "/ws/client") {
      wssClient.handleUpgrade(request, socket, head, (ws) => {
        const h = handlers.get("/ws/client");
        if (h) h(ws);
        else ws.close(1011, "no handler");
      });
    } else {
      socket.destroy();
    }
  });

  // Start listening
  try {
    await fastify.listen({ port: config.PORT, host: "0.0.0.0" });
  } catch (err) {
    logger.error("boot", `failed to start HTTP listener on port ${config.PORT}`, {
      error: {
        code: "internal.unexpected",
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      },
    });
    process.exit(1);
  }

  logger.info("boot", `Ghostyc relay listening on port ${config.PORT}`, {
    context: {
      port: config.PORT,
      heartbeat_ms: config.GHOSTYC_HEARTBEAT_MS,
      heartbeat_timeout_ms: config.GHOSTYC_HEARTBEAT_TIMEOUT_MS,
      log_buffer_capacity: config.GHOSTYC_LOG_BUFFER_SIZE,
    },
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info("shutdown", `received ${signal}; closing connections`, {
      context: { signal },
    });
    try {
      await hubRef?.close();
      await fastify.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: "relay",
    device: "relay",
    level: "error",
    event: "boot.unhandled",
    message: err instanceof Error ? err.message : String(err),
    request_id: null,
    correlation_id: null,
    error: {
      code: "internal.unexpected",
      message: err instanceof Error ? err.message : String(err),
      at: new Date().toISOString(),
    },
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
  process.exit(1);
});
