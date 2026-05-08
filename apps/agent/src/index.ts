// Ghostyc Windows agent entrypoint.

import "dotenv/config";
import { loadConfig, wsUrlFor } from "./config.js";
import { AgentLogger } from "./logger.js";
import { AgentWsClient } from "./ws-client.js";

function main(): void {
  const cfg = loadConfig(process.env);
  if (!cfg.ok) {
    const entry = {
      timestamp: new Date().toISOString(),
      service: "agent",
      device: process.env.PC_NAME ?? "unknown",
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
  const logger = new AgentLogger({
    device: config.PC_NAME,
    logDir: config.GHOSTYC_AGENT_LOG_DIR,
  });

  logger.info("boot", `Ghostyc agent starting (device=${config.PC_NAME})`, {
    context: {
      relay_url: config.RELAY_URL,
      pc_name: config.PC_NAME,
      log_dir: config.GHOSTYC_AGENT_LOG_DIR,
    },
  });

  const wsUrl = wsUrlFor(config.RELAY_URL, "agent");
  const client = new AgentWsClient({
    url: wsUrl,
    token: config.GHOSTYC_AGENT_TOKEN,
    device_id: config.PC_NAME,
    logger,
  });
  client.start();

  const shutdown = (signal: string) => {
    logger.info("shutdown", `received ${signal}; stopping`, {
      context: { signal },
    });
    client.stop();
    setTimeout(() => process.exit(0), 250);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.error("internal.unexpected", err.message, {
      error: {
        code: "internal.unexpected",
        message: err.message,
        at: new Date().toISOString(),
        details: { stack: err.stack ?? null },
      },
    });
  });
}

main();
