// Ghostyc Linux Mint WoL bridge entrypoint.
//
// Runs anywhere Node + UDP work; the production target is Linux Mint, but it
// is plain dgram-over-UDP, so it boots identically on macOS/Windows for local
// smoke-testing. The role on the wire is always "bridge" (PROTOCOL §1).

import "dotenv/config";
import * as os from "node:os";
import { bridgeWsUrl, loadConfig } from "./config.js";
import { BridgeLogger } from "./logger.js";
import { BridgeWsClient } from "./ws-client.js";

function main(): void {
  const cfg = loadConfig(process.env);
  if (!cfg.ok) {
    const entry = {
      timestamp: new Date().toISOString(),
      service: "bridge",
      device: "mint-bridge",
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
  // PROTOCOL §1.2: bridge device_id is hardcoded "mint-bridge" in V1.
  const deviceId = "mint-bridge";

  const logger = new BridgeLogger({
    device: deviceId,
    logDir: config.GHOSTYC_BRIDGE_LOG_DIR,
  });

  logger.info("boot", `Ghostyc bridge starting (device=${deviceId})`, {
    context: {
      relay_url: config.RELAY_URL,
      pc_mac_address: config.PC_MAC_ADDRESS,
      pc_broadcast_address: config.PC_BROADCAST_ADDRESS,
      log_dir: config.GHOSTYC_BRIDGE_LOG_DIR,
      host: os.hostname(),
      platform: os.platform(),
    },
  });

  const wsUrl = bridgeWsUrl(config.RELAY_URL);
  const client = new BridgeWsClient({
    url: wsUrl,
    token: config.GHOSTYC_BRIDGE_TOKEN,
    device_id: deviceId,
    logger,
    ctx: { config, bootedAtMs: Date.now() },
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
