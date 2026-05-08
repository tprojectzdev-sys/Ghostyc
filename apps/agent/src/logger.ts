// Agent logger: structured JSONL to logs/agent.log with 5MB rotation, keep 5.
// Also emits to stdout. PROTOCOL.md §6.1 + §6.3.

import * as fs from "node:fs";
import * as path from "node:path";
import { redactSecrets, type LogEvent, type LogLevel } from "@ghostyc/protocol";

const ROTATE_BYTES = 5 * 1024 * 1024;
const ROTATE_KEEP = 5;

export type LogForwardFn = (entry: LogEvent) => void;

export class AgentLogger {
  private readonly device: string;
  private readonly filePath: string;
  private bytesWritten = 0;
  private forward: LogForwardFn | null = null;
  private fileSinkOk: boolean;

  constructor(opts: { device: string; logDir: string }) {
    this.device = opts.device;
    this.filePath = path.join(opts.logDir, "agent.log");
    try {
      fs.mkdirSync(opts.logDir, { recursive: true });
      const stat = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      this.bytesWritten = stat?.size ?? 0;
      // probe writability
      fs.appendFileSync(this.filePath, "");
      this.fileSinkOk = true;
    } catch (err) {
      this.fileSinkOk = false;
      const msg = err instanceof Error ? err.message : String(err);
      // Mirror this single boot-time error to stdout so it isn't lost.
      const fallback: LogEvent = {
        timestamp: new Date().toISOString(),
        service: "agent",
        device: this.device,
        level: "warn",
        event: "log.file_unavailable",
        message: `cannot write to ${this.filePath}: ${msg}`,
        request_id: null,
        correlation_id: null,
        context: { path: this.filePath, error: msg },
      };
      process.stdout.write(JSON.stringify(fallback) + "\n");
    }
  }

  setForwarder(fn: LogForwardFn | null): void {
    this.forward = fn;
  }

  log(opts: {
    level: LogLevel;
    event: string;
    message: string;
    request_id?: string | null;
    correlation_id?: string | null;
    command?: string | null;
    status?: string | null;
    duration_ms?: number | null;
    error?: LogEvent["error"];
    retry_count?: number | null;
    connection_state?: string | null;
    context?: Record<string, unknown>;
  }): void {
    const entry: LogEvent = redactSecrets({
      timestamp: new Date().toISOString(),
      service: "agent",
      device: this.device,
      level: opts.level,
      event: opts.event,
      message: opts.message,
      request_id: opts.request_id ?? null,
      correlation_id: opts.correlation_id ?? null,
      command: opts.command ?? null,
      status: opts.status ?? null,
      duration_ms: opts.duration_ms ?? null,
      error: opts.error ?? null,
      retry_count: opts.retry_count ?? null,
      connection_state: opts.connection_state ?? null,
      context: opts.context,
    });
    const line = JSON.stringify(entry) + "\n";
    process.stdout.write(line);
    if (this.fileSinkOk) {
      try {
        fs.appendFileSync(this.filePath, line);
        this.bytesWritten += Buffer.byteLength(line);
        if (this.bytesWritten >= ROTATE_BYTES) this.rotate();
      } catch {
        this.fileSinkOk = false; // disable file sink, keep stdout
      }
    }
    if (this.forward) {
      try { this.forward(entry); } catch { /* must not crash */ }
    }
  }

  debug(event: string, message: string, extra?: Partial<Parameters<AgentLogger["log"]>[0]>) {
    this.log({ level: "debug", event, message, ...(extra ?? {}) });
  }
  info(event: string, message: string, extra?: Partial<Parameters<AgentLogger["log"]>[0]>) {
    this.log({ level: "info", event, message, ...(extra ?? {}) });
  }
  warn(event: string, message: string, extra?: Partial<Parameters<AgentLogger["log"]>[0]>) {
    this.log({ level: "warn", event, message, ...(extra ?? {}) });
  }
  error(event: string, message: string, extra?: Partial<Parameters<AgentLogger["log"]>[0]>) {
    this.log({ level: "error", event, message, ...(extra ?? {}) });
  }

  private rotate(): void {
    try {
      for (let i = ROTATE_KEEP - 1; i >= 1; i--) {
        const src = `${this.filePath}.${i}`;
        const dst = `${this.filePath}.${i + 1}`;
        if (fs.existsSync(src)) {
          if (i + 1 > ROTATE_KEEP) fs.unlinkSync(src);
          else fs.renameSync(src, dst);
        }
      }
      if (fs.existsSync(this.filePath)) {
        fs.renameSync(this.filePath, `${this.filePath}.1`);
      }
      this.bytesWritten = 0;
    } catch {
      this.fileSinkOk = false;
    }
  }
}
