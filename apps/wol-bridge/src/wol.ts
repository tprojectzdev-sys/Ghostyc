// Wake-on-LAN magic packet sender.
//
// A magic packet is 6 × 0xFF followed by 16 repetitions of the 6-byte target
// MAC, totalling 102 bytes. Sent over UDP to the LAN broadcast address
// (typically port 9 — discard service — or 7 — echo).
//
// PROTOCOL.md §13.2 (wake_pc): the bridge ONLY sends the packet. It does not
// verify the PC actually woke up — that is the relay's wake watch.

import * as dgram from "node:dgram";

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

export interface WakeOptions {
  mac: string;
  broadcast: string;
  /** UDP port. Default 9 (discard). */
  port?: number;
  /** Send timeout in ms. Default 1000. */
  timeoutMs?: number;
}

export interface WakeResult {
  packet_sent: true;
  packet_bytes: number;
  /** Numeric port actually used. */
  port: number;
  /** Lower-cased MAC string with colon separators. */
  normalized_mac: string;
}

export class WolError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "WolError";
  }
}

/** Validate and normalize MAC to colon-separated lowercase. */
export function normalizeMac(mac: string): string {
  if (!MAC_RE.test(mac)) {
    throw new WolError(
      "wol.invalid_mac",
      `MAC must match AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF, got "${mac}"`,
    );
  }
  return mac.replace(/-/g, ":").toLowerCase();
}

function buildMagicPacket(mac: string): Buffer {
  const normalized = normalizeMac(mac);
  const macBytes = Buffer.from(normalized.replace(/:/g, ""), "hex");
  if (macBytes.length !== 6) {
    throw new WolError("wol.invalid_mac", `decoded MAC has ${macBytes.length} bytes, expected 6`);
  }
  const header = Buffer.alloc(6, 0xff);
  const body = Buffer.alloc(16 * 6);
  for (let i = 0; i < 16; i++) {
    macBytes.copy(body, i * 6);
  }
  return Buffer.concat([header, body]); // 102 bytes
}

/**
 * Send a magic packet to the given MAC over the LAN broadcast address.
 * Resolves with the result on success; rejects with WolError on failure.
 */
export function sendMagicPacket(opts: WakeOptions): Promise<WakeResult> {
  const port = opts.port ?? 9;
  const timeoutMs = opts.timeoutMs ?? 1000;
  const normalized = normalizeMac(opts.mac);
  const packet = buildMagicPacket(normalized);

  return new Promise<WakeResult>((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let settled = false;
    const finish = (err: WolError | null, res?: WakeResult) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else if (res) resolve(res);
    };

    const timer = setTimeout(() => {
      finish(new WolError("wol.timeout", `magic packet send timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once("error", (err) => {
      clearTimeout(timer);
      finish(new WolError("wol.send_failed", err.message));
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch (err) {
        clearTimeout(timer);
        finish(new WolError("wol.broadcast_failed", err instanceof Error ? err.message : String(err)));
        return;
      }
      socket.send(packet, 0, packet.length, port, opts.broadcast, (err, bytes) => {
        clearTimeout(timer);
        if (err) {
          finish(new WolError("wol.send_failed", err.message));
        } else {
          finish(null, {
            packet_sent: true,
            packet_bytes: bytes,
            port,
            normalized_mac: normalized,
          });
        }
      });
    });
  });
}
