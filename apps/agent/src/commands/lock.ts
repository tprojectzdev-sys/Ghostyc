// `lock` — locks the workstation. PROTOCOL.md §13.1.
// Implementation: rundll32.exe user32.dll,LockWorkStation
// This is the standard, fully documented Windows way to lock a session.

import { runExe } from "./helpers/exec.js";

export async function runLock(): Promise<{ locked: boolean }> {
  await runExe("rundll32.exe", ["user32.dll,LockWorkStation"], { timeout_ms: 4000 });
  return { locked: true };
}
