// Promisified exec helpers for command handlers.
// Standardised so every Windows command goes through the same code path.

import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export interface ExecError extends Error {
  code: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  duration_ms: number;
}

/**
 * Run a Windows executable with arguments. Returns stdout/stderr.
 * Throws an ExecError on non-zero exit.
 */
export async function runExe(
  file: string,
  args: string[],
  opts: { timeout_ms?: number; cwd?: string } = {},
): Promise<ExecResult> {
  const start = Date.now();
  try {
    const execOpts: ExecFileOptions = {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024, // 16 MB — enough for tasklist / Get-Process / screenshot b64
      timeout: opts.timeout_ms ?? 0,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    };
    const { stdout, stderr } = await pExecFile(file, args, execOpts);
    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: string | number;
      signal?: NodeJS.Signals;
    };
    const wrapped: ExecError = Object.assign(new Error(e.message ?? String(err)), {
      code: typeof e.code === "string" ? e.code : "EXEC_FAILED",
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
      exit_code: typeof e.code === "number" ? e.code : null,
      signal: e.signal ?? null,
      duration_ms: Date.now() - start,
    });
    throw wrapped;
  }
}

export function isExecError(err: unknown): err is ExecError {
  return (
    err instanceof Error &&
    "exit_code" in err &&
    "stdout" in err &&
    "stderr" in err
  );
}
