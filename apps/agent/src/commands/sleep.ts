// `sleep` — puts the workstation to sleep (S3). PROTOCOL.md §13.1.
//
// Implementation: P/Invoke SetSuspendState(hibernate=false). The rundll32
// shortcut is unreliable on systems with hibernation enabled (it can hibernate
// instead of sleep), so we go through PowerShell + DllImport.
//
// The Win32 SetSuspendState call BLOCKS until the system wakes up. If we awaited
// the child process the agent would freeze (it gets suspended along with the OS)
// and the relay would record a `timeout` even though sleep succeeded. Instead we
// return `{ scheduled: true }` first, then invoke sleep on the next tick.

import { spawn } from "node:child_process";

const SCRIPT = `
$ErrorActionPreference = 'Stop'
$src = @"
using System.Runtime.InteropServices;
public static class Ghostyc_Power {
    [DllImport("powrprof.dll", SetLastError=true)]
    public static extern bool SetSuspendState(bool Hibernate, bool ForceCritical, bool DisableWakeEvent);
}
"@
Add-Type -TypeDefinition $src -Language CSharp
[void][Ghostyc_Power]::SetSuspendState($false, $false, $false)
`;

export async function runSleep(): Promise<{ scheduled: true }> {
  // Fire-and-forget. The child runs detached so even if we exit it keeps going.
  // We need a writable stdin to pipe the script in, but ignore stdout/stderr.
  setImmediate(() => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "-",
      ],
      {
        windowsHide: true,
        detached: true,
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
    child.unref();
    child.stdin.end(SCRIPT);
  });
  return { scheduled: true };
}
