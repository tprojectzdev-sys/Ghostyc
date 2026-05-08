// In-memory relay state: device registry + command cache.
// PROTOCOL.md §3.5 (devices), §3.6 (commands), §8 (status state machine).

import {
  type CommandRecord,
  type CommandState,
  type DeviceSnapshot,
  type ErrorObject,
  type Role,
} from "@ghostyc/protocol";

export interface DeviceRecord extends DeviceSnapshot {
  // Mutable runtime fields not part of the public snapshot.
  last_error: ErrorObject | null;
  last_command_id: string | null;
  // Bridge-specific: when the bridge last successfully sent a magic packet,
  // updated by the wake_pc orchestrator. Always null on non-bridge devices.
  last_wake_attempt: string | null;
}

export class State {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly commandsById = new Map<string, CommandRecord>();
  private readonly commandsRecent: string[] = [];
  private readonly bootedAt = Date.now();

  uptimeSeconds(): number {
    return Math.floor((Date.now() - this.bootedAt) / 1000);
  }

  // ── Devices ──────────────────────────────────────────────────────────────

  /**
   * Ensure a device record exists with at least `unknown` status, returning it.
   */
  ensureDevice(role: Role, device_id: string): DeviceRecord {
    const existing = this.devices.get(device_id);
    if (existing) return existing;
    const fresh: DeviceRecord = {
      device_id,
      role,
      status: "unknown",
      last_heartbeat: null,
      connected_since: null,
      reconnect_count: 0,
      version: null,
      last_error: null,
      last_command_id: null,
      last_wake_attempt: null,
    };
    this.devices.set(device_id, fresh);
    return fresh;
  }

  getDevice(device_id: string): DeviceRecord | null {
    return this.devices.get(device_id) ?? null;
  }

  getDeviceByRole(role: Role): DeviceRecord | null {
    for (const d of this.devices.values()) {
      if (d.role === role) return d;
    }
    return null;
  }

  /**
   * Mark a device online and bump reconnect counter on every fresh hello.
   * Returns previous status so caller can decide whether to broadcast.
   */
  markOnline(opts: {
    role: Role;
    device_id: string;
    version: string | null;
    now: string;
  }): { previous: DeviceRecord["status"]; record: DeviceRecord } {
    const rec = this.ensureDevice(opts.role, opts.device_id);
    const previous = rec.status;
    if (previous === "offline" || previous === "unknown" || previous === "degraded") {
      rec.reconnect_count += 1;
    }
    rec.status = "online";
    rec.last_heartbeat = opts.now;
    rec.connected_since = opts.now;
    rec.version = opts.version;
    rec.last_error = null;
    return { previous, record: rec };
  }

  markOffline(device_id: string, now: string, reason: string): DeviceRecord | null {
    const rec = this.devices.get(device_id);
    if (!rec) return null;
    if (rec.status !== "offline") {
      rec.status = "offline";
      rec.connected_since = null;
      rec.last_error = {
        code: "ws.disconnected",
        message: reason,
        at: now,
      };
    }
    return rec;
  }

  recordHeartbeat(device_id: string, now: string, version: string | null): DeviceRecord | null {
    const rec = this.devices.get(device_id);
    if (!rec) return null;
    rec.last_heartbeat = now;
    if (version) rec.version = version;
    return rec;
  }

  listDevices(): DeviceRecord[] {
    return Array.from(this.devices.values());
  }

  /**
   * Sweep for heartbeat timeouts. Caller passes timeout_ms; any online device
   * whose last_heartbeat is older than (now - timeout_ms) becomes offline.
   * Returns the list of devices that transitioned.
   */
  sweepHeartbeats(now: number, timeout_ms: number): DeviceRecord[] {
    const transitioned: DeviceRecord[] = [];
    const cutoff = now - timeout_ms;
    for (const rec of this.devices.values()) {
      if (rec.status !== "online" || !rec.last_heartbeat) continue;
      if (Date.parse(rec.last_heartbeat) < cutoff) {
        rec.status = "offline";
        rec.connected_since = null;
        rec.last_error = {
          code: "heartbeat.timeout",
          message: `no heartbeat for >${timeout_ms}ms`,
          at: new Date(now).toISOString(),
        };
        transitioned.push(rec);
      }
    }
    return transitioned;
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  saveCommand(rec: CommandRecord): void {
    this.commandsById.set(rec.request_id, rec);
    this.commandsRecent.push(rec.request_id);
    if (this.commandsRecent.length > 200) {
      const dropped = this.commandsRecent.shift();
      if (dropped) this.commandsById.delete(dropped);
    }
  }

  updateCommand(
    request_id: string,
    patch: Partial<CommandRecord>,
  ): CommandRecord | null {
    const existing = this.commandsById.get(request_id);
    if (!existing) return null;
    Object.assign(existing, patch);
    return existing;
  }

  getCommand(request_id: string): CommandRecord | null {
    return this.commandsById.get(request_id) ?? null;
  }

  /** Remember the last command per device for diagnostics. */
  setLastCommand(device_id: string, request_id: string): void {
    const rec = this.devices.get(device_id);
    if (rec) rec.last_command_id = request_id;
  }

  lastCommandFor(device_id: string): CommandRecord | null {
    const rec = this.devices.get(device_id);
    if (!rec || !rec.last_command_id) return null;
    return this.commandsById.get(rec.last_command_id) ?? null;
  }

  /** Mark the last successful WoL packet send on the bridge device. */
  recordWakeAttempt(device_id: string, at: string): void {
    const rec = this.devices.get(device_id);
    if (rec && rec.role === "bridge") rec.last_wake_attempt = at;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  static publicSnapshot(rec: DeviceRecord): DeviceSnapshot {
    return {
      device_id: rec.device_id,
      role: rec.role,
      status: rec.status,
      last_heartbeat: rec.last_heartbeat,
      connected_since: rec.connected_since,
      reconnect_count: rec.reconnect_count,
      version: rec.version,
    };
  }

  static commandStateFromResultState(s: "success" | "failed" | "timeout" | "target_offline"): CommandState {
    return s;
  }
}
