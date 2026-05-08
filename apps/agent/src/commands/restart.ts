// `restart` — schedules a Windows restart via shutdown.exe /r.
// PROTOCOL.md §13.1.

import { z } from "zod";
import { runExe } from "./helpers/exec.js";

const ArgsSchema = z.object({
  delay_s: z.number().int().min(0).max(600).default(0),
});

export async function runRestart(rawArgs: Record<string, unknown>): Promise<{ scheduled_at: string }> {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new Error(
      `invalid args: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  const delay = parsed.data.delay_s;
  await runExe("shutdown.exe", ["/r", "/t", String(delay), "/f"], {
    timeout_ms: 5000,
  });
  const scheduled_at = new Date(Date.now() + delay * 1000).toISOString();
  return { scheduled_at };
}
