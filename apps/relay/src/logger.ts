// Structured logger for the relay. Writes to:
//   1. The in-memory ring buffer (for live UI / GET /logs/recent / WS broadcast)
//   2. stdout (so Railway captures it)
//   3. Optional JSONL file with rotation, only when GHOSTYC_LOG_DIR is set
//
// All log entries conform to PROTOCOL.md §6.1.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type LogEvent,
  type LogLevel,
  redactSecrets,
} from "@ghostyc/protocol";

const RING_DEFAULT = 500;
const ROTATE_BYTES = 5 * 1024 * 1024;
const ROTATE_KEEP = 5;

interface FileSink {
  filePath: string;
  bytesWritten: number;
}

export interface RingSnapshot {
  size: number;
  capacity: number;
}

export type LogSubscriber = (entry: LogEvent) => void;

export class Logger {
  private readonly device: string;
  private readonly capacity: number;
  private readonly ring: LogEvent[] = [];
  private readonly subscribers = new Set<LogSubscriber>();
  private fileSink: FileSink | null = null;

  constructor(opts: { device: string; bufferSize?: number }) {
    this.device = opts.device;
    this.capacity = opts.bufferSize ?? RING_DEFAULT;
  }

  /** Try to enable JSONL file logging at `${dir}/relay.log`. Returns true if active. */
  enableFileSink(dir: string | undefined): { enabled: boolean; reason?: string; dir?: string } {
    if (!dir) return { enabled: false, reason: "GHOSTYC_LOG_DIR unset" };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, "relay.log");
      const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      this.fileSink = {
        filePath,
        bytesWritten: stat?.size ?? 0,
      };
      // probe writability
      fs.appendFileSync(filePath, "");
      return { enabled: true, dir };
    } catch (err) {
      this.fileSink = null;
      return {
        enabled: false,
        reason: err instanceof Error ? err.message : String(err),
        dir,
      };
    }
  }

  isFileSinkEnabled(): boolean {
    return this.fileSink !== null;
  }

  fileSinkDir(): string | null {
    return this.fileSink ? path.dirname(this.fileSink.filePath) : null;
  }

  subscribe(fn: LogSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  recent(opts: {
    limit?: number;
    since?: string;
    service?: string;
    request_id?: string;
  } = {}): LogEvent[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
    const since = opts.since ? Date.parse(opts.since) : null;
    const out: LogEvent[] = [];
    // newest first
    for (let i = this.ring.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.ring[i]!;
      if (since !== null && Date.parse(e.timestamp) <= since) continue;
      if (opts.service && e.service !== opts.service) continue;
      if (opts.request_id && e.request_id !== opts.request_id) continue;
      out.push(e);
    }
    return out;
  }

  ringSnapshot(): RingSnapshot {
    return { size: this.ring.length, capacity: this.capacity };
  }

  /** Append a log entry produced elsewhere (e.g. forwarded from agent). */
  ingest(entry: LogEvent): void {
    const safe = redactSecrets(entry);
    this.pushRing(safe);
    this.broadcast(safe);
    // Forwarded entries are also written locally so they are not lost on relay restart
    // when GHOSTYC_LOG_DIR is set.
    this.writeFile(safe);
    // stdout mirror so Railway captures it
    process.stdout.write(JSON.stringify(safe) + "\n");
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
    const entry: LogEvent = {
      timestamp: new Date().toISOString(),
      service: "relay",
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
    };
    this.ingest(entry);
  }

  debug(event: string, message: string, extra?: Partial<LogEvent>) {
    this.log({ level: "debug", event, message, ...extra });
  }
  info(event: string, message: string, extra?: Partial<LogEvent>) {
    this.log({ level: "info", event, message, ...extra });
  }
  warn(event: string, message: string, extra?: Partial<LogEvent>) {
    this.log({ level: "warn", event, message, ...extra });
  }
  error(event: string, message: string, extra?: Partial<LogEvent>) {
    this.log({ level: "error", event, message, ...extra });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private pushRing(entry: LogEvent): void {
    this.ring.push(entry);
    if (this.ring.length > this.capacity) {
      const drop = this.ring.length - this.capacity;
      this.ring.splice(0, drop);
    }
  }

  private broadcast(entry: LogEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(entry);
      } catch {
        // a bad subscriber must not break logging
      }
    }
  }

  private writeFile(entry: LogEvent): void {
    if (!this.fileSink) return;
    const line = JSON.stringify(entry) + "\n";
    try {
      fs.appendFileSync(this.fileSink.filePath, line);
      this.fileSink.bytesWritten += Buffer.byteLength(line);
      if (this.fileSink.bytesWritten >= ROTATE_BYTES) {
        this.rotate();
      }
    } catch {
      // disk full / permissions — drop file write but keep ring + stdout alive.
      // We deliberately don't recurse into log() here; that would cause infinite loops.
      this.fileSink = null;
    }
  }

  private rotate(): void {
    if (!this.fileSink) return;
    const base = this.fileSink.filePath;
    try {
      // shift .log.(K-1) → .log.K, drop oldest
      for (let i = ROTATE_KEEP - 1; i >= 1; i--) {
        const src = `${base}.${i}`;
        const dst = `${base}.${i + 1}`;
        if (fs.existsSync(src)) {
          if (i + 1 > ROTATE_KEEP) {
            fs.unlinkSync(src);
          } else {
            fs.renameSync(src, dst);
          }
        }
      }
      if (fs.existsSync(base)) {
        fs.renameSync(base, `${base}.1`);
      }
      this.fileSink.bytesWritten = 0;
    } catch {
      this.fileSink = null;
    }
  }
}
