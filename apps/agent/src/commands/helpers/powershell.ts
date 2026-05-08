// PowerShell helper. Writes the script to a temp .ps1 file and runs it with
// -File. The stdin/-Command path is unreliable in some Windows environments
// (output gets swallowed under specific -OutputFormat / -NonInteractive combos).
// Temp-file invocation is the boring, well-documented way that always works.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PsResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
}

export async function runPowerShell(
  script: string,
  opts: { timeout_ms?: number } = {},
): Promise<PsResult> {
  const start = Date.now();
  const tmp = mkdtempSync(join(tmpdir(), "ghostyc-ps-"));
  const scriptPath = join(tmp, "cmd.ps1");
  writeFileSync(scriptPath, script, { encoding: "utf8" });

  return new Promise<PsResult>((resolve, reject) => {
    const timeoutMs = opts.timeout_ms ?? 30_000;
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
      ],
      { windowsHide: true },
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* ignore */ }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    const cleanup = () => {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    };

    child.on("error", (err) => {
      clearTimeout(killTimer);
      cleanup();
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      cleanup();
      const duration_ms = Date.now() - start;
      if (timedOut) {
        const err = Object.assign(new Error(`powershell timed out after ${timeoutMs}ms`), {
          code: "TIMEOUT",
          stdout,
          stderr,
          exit_code: code,
          duration_ms,
        });
        reject(err);
        return;
      }
      resolve({ stdout, stderr, exit_code: code, duration_ms });
    });
  });
}
