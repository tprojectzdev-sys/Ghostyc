// `status` command — first real command in V1. PROTOCOL.md §13.1.

import * as os from "node:os";
import { type StatusCommandResult } from "@ghostyc/protocol";
import { AGENT_VERSION } from "../version.js";

export async function runStatus(): Promise<StatusCommandResult> {
  const platform = os.platform();
  const release = os.release();
  return {
    os: `${platform} ${release}`,
    hostname: os.hostname(),
    uptime_s: Math.floor(os.uptime()),
    version: AGENT_VERSION,
  };
}
