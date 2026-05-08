// Auth helpers — constant-time token compare. PROTOCOL §2.

import { timingSafeEqual } from "node:crypto";

export function tokenEquals(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // still do a compare against b to keep timing flat
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function bearerFromHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(value);
  return m ? m[1]!.trim() : undefined;
}

// Simple in-process rate limiter for /auth/login. Five attempts per minute per
// process. Personal use only — not intended to defeat a determined attacker.
export class LoginRateLimiter {
  private attempts: number[] = [];
  private readonly windowMs = 60_000;
  private readonly max = 5;

  hit(now: number): boolean {
    this.attempts = this.attempts.filter((t) => now - t < this.windowMs);
    if (this.attempts.length >= this.max) return false;
    this.attempts.push(now);
    return true;
  }
}
