// `open_app` — launches a Windows app by absolute path or by registered name.
// PROTOCOL.md §13.1.
//
// Args (one of):
//   { path: "C:\\path\\to\\app.exe", args?: string[] }
//   { name: "notepad" | "calc" | ... }
// Result: { pid: number }
//
// "name" mode resolves the executable through Windows' App Paths registry
// + PATH lookup (the same mechanism Win+R uses). We use cmd.exe's `start ""`
// for that fallback because it understands shortcuts and association lookups,
// but for "path" we spawn directly so we can capture the real PID.

import { z } from "zod";
import { spawn } from "node:child_process";
import * as fs from "node:fs";

const ArgsSchema = z
  .object({
    path: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    args: z.array(z.string()).max(64).optional(),
  })
  .refine((d) => Boolean(d.path) !== Boolean(d.name), {
    message: "exactly one of `path` or `name` is required",
  });

type Args = z.infer<typeof ArgsSchema>;

export async function runOpenApp(rawArgs: Record<string, unknown>): Promise<{ pid: number; mode: "path" | "name" }> {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new Error(
      `invalid args: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  const args = parsed.data as Args;

  if (args.path) {
    if (!fs.existsSync(args.path)) {
      throw new Error(`path does not exist: ${args.path}`);
    }
    const child = spawn(args.path, args.args ?? [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    if (child.pid == null) {
      throw new Error(`spawn returned no pid for ${args.path}`);
    }
    child.unref();
    return { pid: child.pid, mode: "path" };
  }

  // name-mode: ask cmd.exe to start it, mirroring Win+R behaviour.
  const child = spawn(
    "cmd.exe",
    ["/c", "start", "", args.name as string, ...(args.args ?? [])],
    { windowsHide: true, detached: true, stdio: "ignore" },
  );
  if (child.pid == null) {
    throw new Error(`spawn returned no pid for cmd start ${args.name}`);
  }
  child.unref();
  // The pid here is cmd.exe's, not the actual launched app's. We return it
  // honestly with mode:"name" so the caller knows it isn't the app pid itself.
  return { pid: child.pid, mode: "name" };
}
