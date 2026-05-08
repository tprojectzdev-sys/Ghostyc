// `shutdown` — schedules a Windows shutdown via shutdown.exe.
// PROTOCOL.md §13.1.
//
// Args: { delay_s?: number } — 0..600, default 0
// Result: { scheduled_at: string }   (ISO timestamp of the planned shutdown)
//
// Note on test safety:
// shutdown.exe /s /t <seconds> schedules the shutdown. It can be cancelled with
// `shutdown /a`. We never execute "/t 0" silently in tests — only when the user
// explicitly asks.

import { z } from "zod";
import { runExe } from "./helpers/exec.js";

const ArgsSchema = z.object({
  delay_s: z.number().int().min(0).max(600).default(0),
});

export async function runShutdown(rawArgs: Record<string, unknown>): Promise<{ scheduled_at: string }> {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new Error(
      `invalid args: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  const delay = parsed.data.delay_s;
  // /s = shutdown, /t = timeout in seconds, /f = force-close apps without prompting
  await runExe("shutdown.exe", ["/s", "/t", String(delay), "/f"], {
    timeout_ms: 5000,
  });
  const scheduled_at = new Date(Date.now() + delay * 1000).toISOString();
  return { scheduled_at };
}
