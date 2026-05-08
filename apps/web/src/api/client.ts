const BASE = import.meta.env.VITE_RELAY_URL || "";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("ghostyc_token");
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "network.unreachable",
      "Cannot reach relay API. Ensure relay is running and reachable.",
    );
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Keep json=null; non-JSON responses are still represented via status text.
  }

  if (!res.ok) {
    const body = json as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? res.statusText,
      json,
    );
  }
  return json as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface LoginResponse {
  token: string;
  expires_at: string | null;
  request_id: string;
}

export interface WhoamiResponse {
  role: string;
  server_time: string;
  protocol_version: string;
  request_id: string;
}

export interface DeviceSnapshot {
  device_id: string;
  role: string;
  status: "online" | "offline" | "degraded" | "unknown";
  last_heartbeat: string | null;
  connected_since: string | null;
  reconnect_count: number;
  version: string | null;
}

export interface CommandAccepted {
  request_id: string;
  status: "accepted";
  submitted_at: string;
}

export interface CommandRecord {
  request_id: string;
  state: string;
  submitted_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: unknown;
  error: { code: string; message: string } | null;
}

export interface LogEntry {
  timestamp: string;
  service: string;
  device: string;
  level: string;
  event: string;
  message: string;
  request_id?: string | null;
  command?: string | null;
  status?: string | null;
  duration_ms?: number | null;
  error?: { code: string; message: string } | null;
  context?: Record<string, unknown>;
}

export interface DiagnosticsSnapshot {
  relay: {
    status: string;
    uptime_s: number;
    protocol_version: string;
    ws_clients_connected: number;
    log_buffer_size: number;
    log_buffer_capacity: number;
    persistent_logs: { enabled: boolean; dir: string | null };
  };
  agent: (DeviceSnapshot & {
    last_command: { request_id: string; command: string; state: string; finished_at: string | null } | null;
    last_error: { code: string; message: string } | null;
  }) | null;
  bridge: (DeviceSnapshot & {
    last_wake_attempt: string | null;
    last_error: { code: string; message: string } | null;
  }) | null;
  auth: {
    client_token_present: boolean;
    agent_token_present: boolean;
    bridge_token_present: boolean;
  };
  request_id: string;
}

export const api = {
  login(password: string) {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  whoami() {
    return request<WhoamiResponse>("/auth/whoami");
  },

  health() {
    return request<{ status: string; uptime_s: number; protocol_version: string }>("/health");
  },

  devices() {
    return request<{ devices: DeviceSnapshot[]; request_id: string }>("/devices");
  },

  postCommand(target: "agent" | "bridge", command: string, args: Record<string, unknown> = {}, timeout_ms?: number) {
    return request<CommandAccepted>("/commands", {
      method: "POST",
      body: JSON.stringify({ target, command, args, ...(timeout_ms ? { timeout_ms } : {}) }),
    });
  },

  getCommand(request_id: string) {
    return request<CommandRecord>(`/commands/${request_id}`);
  },

  recentLogs(limit = 100, opts?: { since?: string; service?: string; request_id?: string }) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts?.since) params.set("since", opts.since);
    if (opts?.service) params.set("service", opts.service);
    if (opts?.request_id) params.set("request_id", opts.request_id);
    return request<{ logs: LogEntry[]; request_id: string }>(`/logs/recent?${params}`);
  },

  diagnostics() {
    return request<DiagnosticsSnapshot>("/diagnostics");
  },
};
