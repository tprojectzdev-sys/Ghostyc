// `kill_process` — terminates one or more processes by pid OR by name.
// PROTOCOL.md §13.1.
//
// Args (one of):
//   { pid: 1234 }
//   { name: "notepad.exe" }   // matched against tasklist /im — exact match only
// Result: { killed: number[], not_found: number[] | string[] }
//
// We use taskkill.exe /F because it's the standard Windows way to terminate
// arbitrary processes and it returns clear exit codes per pid.

import { z } from "zod";
import { runExe, isExecError } from "./helpers/exec.js";

const ArgsSchema = z
  .object({
    pid: z.number().int().positive().optional(),
    name: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.pid) !== Boolean(d.name), {
    message: "exactly one of `pid` or `name` is required",
  });

export async function runKillProcess(rawArgs: Record<string, unknown>) {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new Error(
      `invalid args: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  const args = parsed.data;

  if (typeof args.pid === "number") {
    return killByPid(args.pid);
  }
  return killByName(args.name as string);
}

async function killByPid(pid: number) {
  try {
    const res = await runExe("taskkill.exe", ["/F", "/PID", String(pid)], {
      timeout_ms: 5000,
    });
    return {
      killed: [pid],
      not_found: [] as number[],
      stdout: res.stdout.trim(),
    };
  } catch (err) {
    if (isExecError(err)) {
      // taskkill returns 128 when the pid is not found; surface honestly.
      const notFound = /not found|could not find|no running/i.test(err.stderr + err.stdout);
      if (notFound) {
        return {
          killed: [] as number[],
          not_found: [pid],
          stdout: err.stdout.trim() || err.stderr.trim(),
        };
      }
      throw new Error(
        `taskkill failed (exit=${err.exit_code}): ${(err.stderr || err.stdout).trim() || err.message}`,
      );
    }
    throw err;
  }
}

async function killByName(name: string) {
  // /IM expects the image name; Windows expects "notepad.exe" not "notepad",
  // but taskkill is forgiving. Pass through verbatim.
  try {
    const res = await runExe("taskkill.exe", ["/F", "/IM", name], {
      timeout_ms: 5000,
    });
    // taskkill prints "SUCCESS: The process \"notepad.exe\" with PID 1234 has been terminated."
    const pids: number[] = [];
    const re = /PID\s+(\d+)/gi;
    for (const m of res.stdout.matchAll(re)) {
      pids.push(Number(m[1]));
    }
    return {
      killed: pids,
      not_found: [] as string[],
      stdout: res.stdout.trim(),
    };
  } catch (err) {
    if (isExecError(err)) {
      const notFound = /not found|could not find|no running/i.test(err.stderr + err.stdout);
      if (notFound) {
        return {
          killed: [] as number[],
          not_found: [name],
          stdout: err.stdout.trim() || err.stderr.trim(),
        };
      }
      throw new Error(
        `taskkill failed (exit=${err.exit_code}): ${(err.stderr || err.stdout).trim() || err.message}`,
      );
    }
    throw err;
  }
}
