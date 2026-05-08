// `list_processes` — enumerates running processes via PowerShell Get-Process.
// PROTOCOL.md §13.1.
//
// Returned fields per process: pid, name, cpu_percent, mem_mb.
// We deliberately set cpu_percent to null because real instantaneous CPU
// percent requires sampling over an interval; a single Get-Process snapshot
// returns total accumulated CPU seconds, not "%" — and per the no-fake-data
// rule we never fabricate. Phase 6 polish can add interval sampling.

import { z } from "zod";
import { runPowerShell } from "./helpers/powershell.js";

const ArgsSchema = z.object({
  limit: z.number().int().min(1).max(500).default(50),
  sort: z.enum(["mem", "name", "pid"]).default("mem"),
});

type RawProc = { Id: number; ProcessName: string; WorkingSet64: number };

export async function runListProcesses(rawArgs: Record<string, unknown>) {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new Error(
      `invalid args: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  const { limit, sort } = parsed.data;

  const script = `
$ErrorActionPreference = 'Stop'
Get-Process -ErrorAction SilentlyContinue |
  Select-Object Id, ProcessName, WorkingSet64 |
  ConvertTo-Json -Compress -Depth 2
`;
  const result = await runPowerShell(script, { timeout_ms: 8000 });
  if (result.exit_code !== 0 && result.exit_code !== null) {
    throw new Error(`Get-Process failed (exit=${result.exit_code}): ${result.stderr.trim() || "no stderr"}`);
  }

  const trimmed = result.stdout.trim();
  if (!trimmed) {
    throw new Error("Get-Process returned no output");
  }

  let raw: RawProc[];
  try {
    const parsed_json = JSON.parse(trimmed);
    raw = Array.isArray(parsed_json) ? parsed_json : [parsed_json];
  } catch (err) {
    throw new Error(
      `failed to parse Get-Process JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let processes = raw
    .filter((p) => typeof p.Id === "number" && typeof p.ProcessName === "string")
    .map((p) => ({
      pid: p.Id,
      name: p.ProcessName,
      cpu_percent: null as number | null,
      mem_mb: Math.round((p.WorkingSet64 / (1024 * 1024)) * 10) / 10,
    }));

  if (sort === "mem") processes.sort((a, b) => b.mem_mb - a.mem_mb);
  else if (sort === "name") processes.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "pid") processes.sort((a, b) => a.pid - b.pid);

  if (processes.length > limit) processes = processes.slice(0, limit);

  return {
    processes,
    total: raw.length,
    returned: processes.length,
    sort,
  };
}
