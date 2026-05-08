# Ghostyc Protocol Specification

**Version:** `1.0.0-draft` (Phase 0)
**Status:** Draft, locked after approval. While draft, edits are made in place. After lock, any change requires bumping `protocol_version`.
**Audience:** Railway relay, Windows Agent, Linux Mint WoL bridge, Web dashboard, iPhone app.

This document is the single source of truth for how Ghostyc components talk to each other. Implementations MUST conform to this spec. If a component cannot conform, the spec is updated first, then the component.

---

## 1. Roles and Identities

Ghostyc has exactly four logical roles. Every connection is one of these.

| Role     | Who it is                            | Direction          | Auth header       |
|----------|--------------------------------------|--------------------|-------------------|
| `client` | Web dashboard, iPhone app            | inbound to relay   | `GHOSTYC_CLIENT_TOKEN` |
| `agent`  | Windows PC agent                     | outbound to relay  | `GHOSTYC_AGENT_TOKEN`  |
| `bridge` | Linux Mint WoL bridge                | outbound to relay  | `GHOSTYC_BRIDGE_TOKEN` |
| `relay`  | Railway backend                      | central hub        | n/a               |

There is exactly **one** of each `agent` and `bridge` in V1. There can be multiple `client` connections (web tab + phone), but only one user.

A `device_id` is a stable string assigned per role:
- agent: `PC_NAME` env var, e.g. `"Tokyo-PC"`
- bridge: hardcoded `"mint-bridge"` in V1
- client: ephemeral UUID per session, not persisted

---

## 2. Auth Model

Personal use only. No OAuth, no users, no roles.

### 2.1 Tokens

Four secrets, set as environment variables on the relay:

```
GHOSTYC_CLIENT_TOKEN=<random-32-byte-hex>
GHOSTYC_AGENT_TOKEN=<random-32-byte-hex>
GHOSTYC_BRIDGE_TOKEN=<random-32-byte-hex>
GHOSTYC_ADMIN_PASSWORD=<password>
```

- `GHOSTYC_ADMIN_PASSWORD` is the only thing the human ever types. The dashboard / iPhone app exchanges it for `GHOSTYC_CLIENT_TOKEN` via `POST /auth/login`.
- `GHOSTYC_AGENT_TOKEN` and `GHOSTYC_BRIDGE_TOKEN` are baked into the agent and bridge environment files. Never sent by clients.
- Tokens are compared with constant-time equality on the relay.

### 2.3 Token exposure rules (clients)

- The client token is stored locally (browser `localStorage` / iOS Keychain) and sent in `Authorization` headers and the WS `hello`. **It is never rendered in normal UI.**
- The Settings (or a dedicated debug) screen MAY reveal the token — masked by default with a "show" toggle and a "rotate" / "log out" action. This is the only place a raw token is allowed on screen.
- Logs MUST NOT contain raw tokens. The relay MUST redact any field literally named `token`, `password`, or `Authorization` to `"[redacted]"` before storing or broadcasting a log entry.

### 2.2 How auth is presented

| Channel   | How                                                        |
|-----------|------------------------------------------------------------|
| REST      | HTTP header `Authorization: Bearer <token>`                |
| WebSocket | First frame after open is a `hello` message (see §4.3)     |

Failed auth on REST → `401` with error code `auth.invalid_token`.
Failed auth on WS → server sends one `error` frame and closes with code `4401`.

---

## 3. REST API

Base URL: `https://<relay-host>` (Railway).
All bodies are JSON. All responses have `Content-Type: application/json; charset=utf-8`.

All success responses include `request_id` (server-generated UUIDv4 if the client did not pass one in the `X-Request-Id` header).

### 3.1 Endpoint list

| Method | Path                           | Auth     | Purpose                                                |
|--------|--------------------------------|----------|--------------------------------------------------------|
| GET    | `/health`                      | none     | Liveness for Railway health checks                     |
| POST   | `/auth/login`                  | password | Exchange admin password for client token              |
| GET    | `/auth/whoami`                 | client   | Verify client token, return role + server time         |
| GET    | `/devices`                     | client   | Current status of agent + bridge                       |
| POST   | `/commands`                    | client   | Submit a command for the agent or bridge               |
| GET    | `/commands/:request_id`        | client   | Fetch the latest known result for a command            |
| GET    | `/logs/recent?limit=N&since=…` | client   | Fetch recent stored log entries (newest first)         |
| GET    | `/diagnostics`                 | client   | Full diagnostics snapshot (real data only)             |

V1 freeze: no other REST endpoints. V2 candidates do not appear here.

### 3.2 `GET /health`

```json
{ "status": "ok", "uptime_s": 12345, "protocol_version": "1.0.0-draft" }
```

### 3.3 `POST /auth/login`

Request:
```json
{ "password": "<GHOSTYC_ADMIN_PASSWORD>" }
```

Response 200:
```json
{
  "token": "<GHOSTYC_CLIENT_TOKEN>",
  "expires_at": null,
  "request_id": "uuid"
}
```

`expires_at` is always `null` in V1 (token does not expire). Field exists so V2 can add expiry without breaking clients.

Errors: `auth.invalid_password` (401), `auth.rate_limited` (429).

### 3.4 `GET /auth/whoami`

Response 200:
```json
{
  "role": "client",
  "server_time": "2026-05-08T12:00:00.000Z",
  "protocol_version": "1.0.0-draft",
  "request_id": "uuid"
}
```

### 3.5 `GET /devices`

Response 200:
```json
{
  "devices": [
    {
      "device_id": "Tokyo-PC",
      "role": "agent",
      "status": "online",
      "last_heartbeat": "2026-05-08T12:00:00.000Z",
      "connected_since": "2026-05-08T11:00:00.000Z",
      "reconnect_count": 0,
      "version": "0.1.0"
    },
    {
      "device_id": "mint-bridge",
      "role": "bridge",
      "status": "offline",
      "last_heartbeat": "2026-05-08T11:55:00.000Z",
      "connected_since": null,
      "reconnect_count": 4,
      "version": "0.1.0"
    }
  ],
  "request_id": "uuid"
}
```

`status` ∈ `online | offline | degraded | unknown` (see §8).

### 3.6 `POST /commands`

Request:
```json
{
  "target": "agent",
  "command": "lock",
  "args": {},
  "timeout_ms": 10000,
  "request_id": "optional-client-uuid"
}
```

- `target` ∈ `agent | bridge`. The relay routes by role. V1 has one of each, so `target` is enough.
- `command` is one of the names in §5 / §6.
- `args` shape depends on the command.
- `timeout_ms`: see §10. Optional, server clamps to `[1000, 60000]` and falls back to the per-command default.
- `request_id`: optional. If absent, server generates one. See §9.

Response 202 (accepted):
```json
{
  "request_id": "uuid",
  "status": "accepted",
  "submitted_at": "2026-05-08T12:00:00.000Z"
}
```

Response 4xx (rejected — command never reached the agent):
```json
{
  "request_id": "uuid",
  "status": "rejected",
  "reason": "target_offline",
  "error": {
    "code": "command.target_offline",
    "message": "agent 'Tokyo-PC' is offline"
  }
}
```

Rejection reasons (mirrored as error codes in §7):
- `target_offline` → 409
- `unknown_command` → 400
- `invalid_args` → 400
- `auth_failed` → 401
- `rate_limited` → 429

The actual command **result** does not come back on this REST call. It comes through WebSocket as a `command.result` event (§4.4). The REST call only confirms acceptance.

`GET /commands/:request_id` returns the latest cached state, useful for clients that reconnect mid-command:
```json
{
  "request_id": "uuid",
  "state": "running",
  "submitted_at": "...",
  "started_at": "...",
  "finished_at": null,
  "result": null,
  "error": null
}
```

`state` ∈ `accepted | running | success | failed | timeout | target_offline | rejected`.

### 3.7 `GET /logs/recent`

Query params:
- `limit`: 1–500, default 100
- `since`: ISO timestamp, optional (returns logs strictly newer than `since`)
- `service`: optional filter `relay | agent | bridge | client`
- `request_id`: optional filter (all logs for one command)

Response 200:
```json
{
  "logs": [ /* array of log events, see §6 */ ],
  "request_id": "uuid"
}
```

### 3.8 `GET /diagnostics`

Returns a real snapshot. No fabricated values. Anything unknown is `null` or `"unknown"`.

```json
{
  "relay": {
    "status": "ok",
    "uptime_s": 12345,
    "protocol_version": "1.0.0-draft",
    "ws_clients_connected": 2,
    "log_buffer_size": 100,
    "log_buffer_capacity": 500
  },
  "agent": {
    "device_id": "Tokyo-PC",
    "status": "online",
    "last_heartbeat": "...",
    "connected_since": "...",
    "reconnect_count": 0,
    "last_command": { "request_id": "...", "command": "lock", "state": "success", "finished_at": "..." },
    "last_error": null,
    "version": "0.1.0"
  },
  "bridge": {
    "device_id": "mint-bridge",
    "status": "offline",
    "last_heartbeat": "...",
    "connected_since": null,
    "reconnect_count": 4,
    "last_wake_attempt": null,
    "last_error": { "code": "ws.disconnected", "message": "...", "at": "..." },
    "version": "0.1.0"
  },
  "auth": { "client_token_present": true, "agent_token_present": true, "bridge_token_present": true },
  "request_id": "uuid"
}
```

---

## 4. WebSocket Protocol

### 4.1 Endpoints

| Path         | Who connects |
|--------------|--------------|
| `/ws/client` | dashboard + iPhone |
| `/ws/agent`  | Windows agent |
| `/ws/bridge` | Linux Mint bridge |

Three paths instead of one shared path. This makes auth role-specific and prevents an agent token from ever being usable as a client.

### 4.2 Message envelope

Every WS frame, both directions, is a single JSON object with this exact shape:

```json
{
  "v": 1,
  "type": "<message-type>",
  "id": "uuid-of-this-message",
  "request_id": "uuid-or-null",
  "correlation_id": "uuid-or-null",
  "ts": "2026-05-08T12:00:00.000Z",
  "data": { /* payload, type-specific */ }
}
```

Rules:
- `v` is the envelope version. V1 = `1`. Bump only on breaking envelope changes.
- `type` is required. Unknown types are dropped + logged with `event: "ws.unknown_type"`.
- `id` is unique per message (UUIDv4). Used for idempotency and dedupe on reconnect.
- `request_id` is set on every frame related to a command (§9).
- `correlation_id` is set on system events not tied to a command (e.g. heartbeat groups, connection lifecycle).
- `ts` is the sender's clock, ISO-8601 UTC with milliseconds.
- `data` is type-specific. Every concrete message type below specifies its `data` shape.

If a frame violates the envelope (missing `type`, bad JSON, `v != 1`), the receiver MUST log it as `event: "ws.malformed"` and ignore it. The receiver MUST NOT crash.

### 4.3 First-frame handshake (`hello` / `welcome`)

Every WS connection opens with the **client side** sending a `hello`. The server replies with `welcome` or closes with code 4401.

`hello` (client → server), `data`:
```json
{
  "role": "agent",
  "device_id": "Tokyo-PC",
  "token": "<role-specific-token>",
  "version": "0.1.0",
  "protocol_version": "1.0.0-draft"
}
```

`welcome` (server → client), `data`:
```json
{
  "session_id": "uuid",
  "server_time": "2026-05-08T12:00:00.000Z",
  "heartbeat_interval_ms": 25000,
  "heartbeat_timeout_ms": 60000
}
```

After `welcome`, the connection is live. Before it, no other frames are processed.

### 4.4 Message types

All types are namespaced. The full V1 list:

| Type                  | Direction          | Purpose |
|-----------------------|--------------------|---------|
| `hello`               | client→server      | Auth handshake |
| `welcome`             | server→client      | Handshake ack |
| `error`               | server→client      | Auth/protocol error before close |
| `heartbeat`           | both               | Keep-alive (§5) |
| `device.status`       | server→client(role=client) | Device online/offline broadcast |
| `command.dispatch`    | server→agent/bridge | Relay forwarding a command to executor |
| `command.ack`         | agent/bridge→server | Executor accepted the dispatch (started running) |
| `command.result`      | agent/bridge→server, server→client | Final outcome of a command |
| `log.event`           | agent/bridge→server, server→client | Structured log entry (§6) |

That is the complete V1 set. Adding a new type requires updating this spec first.

#### `command.dispatch` (server → agent/bridge)

```json
{
  "v": 1, "type": "command.dispatch", "id": "...", "request_id": "...", "ts": "...",
  "data": {
    "command": "lock",
    "args": {},
    "timeout_ms": 10000,
    "issued_by": "client",
    "issued_at": "2026-05-08T12:00:00.000Z"
  }
}
```

Executor MUST respond with `command.ack` within 2s, then with `command.result` before `timeout_ms` elapses.

#### `command.ack` (executor → server)

```json
{
  "v": 1, "type": "command.ack", "id": "...", "request_id": "...", "ts": "...",
  "data": { "started_at": "..." }
}
```

#### `command.result` (executor → server, then server → clients)

```json
{
  "v": 1, "type": "command.result", "id": "...", "request_id": "...", "ts": "...",
  "data": {
    "state": "success",
    "started_at": "...",
    "finished_at": "...",
    "duration_ms": 124,
    "result": { /* command-specific */ },
    "error": null
  }
}
```

`state` ∈ `success | failed | timeout | target_offline`.
On failure, `result` is `null` and `error` is an Error object (§7.2).

#### `device.status` (server → clients)

```json
{
  "v": 1, "type": "device.status", "id": "...", "correlation_id": "...", "ts": "...",
  "data": {
    "device_id": "Tokyo-PC",
    "role": "agent",
    "status": "offline",
    "last_heartbeat": "...",
    "reconnect_count": 1,
    "reason": "heartbeat_timeout"
  }
}
```

Broadcast whenever a device transitions online↔offline↔degraded.

#### `log.event` (executor → server, then server → clients)

Carries one log entry. The `data` field is exactly the log schema in §6.

---

## 5. Heartbeats

### 5.1 Cadence

- `heartbeat_interval_ms`: 25000 (25 seconds). Server tells the executor in `welcome`.
- `heartbeat_timeout_ms`: 60000 (60 seconds). After this many ms with no heartbeat, the relay marks the device offline.

Both agent and bridge send heartbeats. Clients do not (the server sends `device.status` to clients).

### 5.2 Schema

```json
{
  "v": 1, "type": "heartbeat", "id": "...", "correlation_id": "...", "ts": "...",
  "data": {
    "device_id": "Tokyo-PC",
    "role": "agent",
    "uptime_s": 3600,
    "version": "0.1.0",
    "metrics": {
      "cpu_percent": null,
      "mem_percent": null,
      "wifi_signal": null
    }
  }
}
```

Metrics are best-effort. Anything unavailable is `null` (NOT `0`, never fabricated).

### 5.3 Server response

The relay does NOT echo heartbeats back. It updates `last_heartbeat` and emits `device.status` to clients only on transitions.

---

## 6. Logging

### 6.1 Log event schema

Every component emits this exact shape. Used as both file logs and `log.event` WS payloads.

```json
{
  "timestamp": "2026-05-08T12:00:00.000Z",
  "service": "agent",
  "device": "Tokyo-PC",
  "level": "info",
  "event": "command.execute",
  "message": "Opened app successfully",
  "request_id": "uuid-or-null",
  "correlation_id": "uuid-or-null",
  "command": "open_app",
  "status": "success",
  "duration_ms": 124,
  "error": null,
  "retry_count": 0,
  "connection_state": null,
  "context": { /* optional, free-form, small */ }
}
```

Required fields: `timestamp`, `service`, `device`, `level`, `event`, `message`.
All other fields: include if relevant; otherwise `null` or omit. Never fake.

- `service` ∈ `relay | agent | bridge | client`
- `level` ∈ `debug | info | warn | error`
- `event` is a dotted name like `ws.connected`, `command.execute`, `wol.send`, `auth.failed`. New events MUST be documented when added.
- `error` is `null` or an Error object (§7.2).
- `context` is for one-off debugging fields. Keep it small (<2KB).

### 6.2 Standard event names (V1)

| event                   | service(s)        | meaning |
|-------------------------|-------------------|---------|
| `boot`                  | all               | Process started |
| `config.invalid`        | all               | Required env var missing |
| `ws.connecting`         | agent, bridge     | Outbound WS attempt |
| `ws.connected`          | all               | WS handshake complete |
| `ws.disconnected`       | all               | WS closed (with reason) |
| `ws.reconnect_scheduled`| agent, bridge     | Phase A backoff timer set (per attempt) |
| `ws.degraded_entered`   | agent, bridge     | Entered 5-minute retry mode after 10 failed attempts |
| `ws.degraded_exited`    | agent, bridge     | Recovered from degraded mode |
| `ws.degraded_summary`   | agent, bridge     | Hourly summary while in degraded mode |
| `ws.malformed`          | all               | Bad envelope received |
| `ws.unknown_type`       | all               | Unknown `type` received |
| `auth.success`          | relay             | Handshake or REST auth ok |
| `auth.failed`           | relay             | Bad token / password |
| `heartbeat.sent`        | agent, bridge     | (debug level) |
| `heartbeat.timeout`     | relay             | Device marked offline |
| `device.status_changed` | relay             | Online/offline transition |
| `command.received`      | relay             | REST `/commands` accepted |
| `command.dispatched`    | relay             | Forwarded to executor |
| `command.acked`         | relay, executor   | Executor acked dispatch |
| `command.execute`       | agent, bridge     | Executor ran the command |
| `command.result`        | relay, executor   | Final state recorded |
| `command.timeout`       | relay             | No result before deadline |
| `command.rejected`      | relay             | REST rejection (target_offline etc.) |
| `wol.send`              | bridge            | Magic packet emitted |
| `wol.failed`            | bridge            | Could not send packet |
| `wake.watching`         | relay             | Stage 2 wake watch started |
| `wake.watch_resolved`   | relay             | Stage 2 wake watch ended (success or timeout) |
| `log.persistent_enabled`| relay             | JSONL file logging active (boot) |
| `log.ephemeral`         | relay             | No persistent volume; ring buffer only (boot) |
| `log.dropped`           | all               | Buffer overflow drop (with count) |

### 6.3 Storage

| Component | Storage | Retention |
|-----------|---------|-----------|
| Relay     | **In-memory ring buffer** (default 500 entries, configurable via `GHOSTYC_LOG_BUFFER_SIZE`) used by the live UI; **plus** optional JSONL file logging at `${GHOSTYC_LOG_DIR}/relay.log` with rotation at 5MB, keep 5 files, **only when** `GHOSTYC_LOG_DIR` points to a writable Railway persistent volume | Buffer until eviction; files until rotation |
| Agent     | Local JSON-lines file `logs/agent.log` with rotation at 5MB, keep 5 files | ~25MB total |
| Bridge    | Local JSON-lines file `logs/bridge.log` with rotation at 5MB, keep 5 files | ~25MB total |
| Web       | Console only, structured. Optionally surfaces via `log.event` from server. | Session |

No SQL, no Redis, no ELK in V1.

**Source of truth:** the agent's and bridge's local JSONL files are the
authoritative log record. The relay's ring buffer feeds the live dashboard;
when running without a persistent volume, **relay logs are explicitly
ephemeral** — they are lost on every relay restart/redeploy, and the dashboard
will show an empty log buffer until new events arrive. To debug an incident
that happened before a relay restart, read the agent or bridge log files.

On boot the relay logs one of:
- `event: "log.persistent_enabled"` with `context: { dir, rotation_mb, keep }` — JSONL file logging is active.
- `event: "log.ephemeral"` — `GHOSTYC_LOG_DIR` is unset or unwritable; the ring buffer is the only relay-side store and will not survive restarts.

### 6.4 Log forwarding

The relay receives `log.event` frames from agent and bridge, stores them in its ring buffer, and re-broadcasts them to all `/ws/client` connections. Clients render them live.

---

## 7. Errors

### 7.1 Error codes

All errors use a flat dotted code. The full V1 set:

| Code                          | HTTP | Meaning |
|-------------------------------|------|---------|
| `auth.invalid_token`          | 401  | Token did not match |
| `auth.invalid_password`       | 401  | Wrong admin password |
| `auth.missing`                | 401  | No Authorization header |
| `auth.rate_limited`           | 429  | Too many failed attempts |
| `request.malformed`           | 400  | Bad JSON / missing field |
| `request.invalid_args`        | 400  | Args failed schema check |
| `command.unknown`             | 400  | Command name not recognized |
| `command.target_offline`      | 409  | Agent or bridge not connected |
| `command.timeout`             | 504  | No result before deadline |
| `command.failed`              | 500  | Executor returned failure |
| `command.rejected`            | 409  | Generic rejection |
| `command.not_implemented`     | 501  | Executor recognises the command but cannot run it on this build |
| `command.image_too_large`     | 500  | `screenshot` encoded image exceeded the 1.5 MB cap even at min quality |
| `wake.agent_no_show`          | 504  | WoL packet sent, but the agent did not reconnect within `timeout_ms` |
| `ws.malformed`                | n/a  | Bad envelope (logged, not returned) |
| `ws.unauthorized`             | 4401 | WS close code |
| `ws.protocol_violation`       | 4400 | WS close code |
| `internal.unexpected`         | 500  | Catch-all; MUST include stack in logs, not in response |

WS close codes: 4401 (unauth), 4400 (protocol), 4408 (heartbeat timeout from server side).

### 7.2 Error object

Used in REST bodies, in `command.result.error`, and in log entries.

```json
{
  "code": "command.target_offline",
  "message": "agent 'Tokyo-PC' is offline",
  "details": { /* optional, structured */ },
  "at": "2026-05-08T12:00:00.000Z",
  "request_id": "uuid-or-null"
}
```

`message` is human-readable. Never `"Something went wrong"`. Always names the component, the event, and the cause if known. Stack traces go in logs, never in REST responses.

---

## 8. Device Status

`status` ∈ four values. Definitions are exact.

| Status     | Meaning |
|------------|---------|
| `online`   | WS connected AND last heartbeat within `heartbeat_timeout_ms` |
| `offline`  | WS not connected, OR last heartbeat older than `heartbeat_timeout_ms` |
| `degraded` | WS connected, heartbeats arriving, but the executor self-reported a problem (e.g. agent says it cannot list processes due to permissions). Not used in V1 unless an executor explicitly sets it. |
| `unknown`  | Relay just booted and has never seen this device. |

State machine:
```
unknown ─(hello+welcome)→ online
online  ─(ws closed | heartbeat timeout)→ offline
offline ─(hello+welcome)→ online
online  ─(executor self-report)→ degraded ─(executor self-clear)→ online
```

Every transition emits one `event: "device.status_changed"` log and one `device.status` WS broadcast.

---

## 9. Request IDs and Correlation IDs

### 9.1 Request ID

A `request_id` is a UUIDv4 string that follows ONE command end-to-end:

```
client → POST /commands (X-Request-Id or generated)
       → relay logs it (event: command.received, request_id)
       → relay sends command.dispatch over WS (request_id in envelope)
       → agent receives, logs (event: command.execute, request_id)
       → agent runs the command
       → agent sends command.result (request_id in envelope)
       → relay logs it (event: command.result, request_id)
       → relay broadcasts command.result to clients (request_id in envelope)
       → relay's GET /commands/:request_id can return the cached state
```

Every log line touched by this command MUST carry the same `request_id`.

### 9.2 Correlation ID

A `correlation_id` groups system events not caused by a command. Examples:
- All log events from a single WS reconnect attempt share one correlation_id.
- All heartbeats from one connection lifecycle MAY share one (optional).
- A WoL bridge's "wake attempt" sequence (received command, send packet, log result) shares one correlation_id derived from the request_id; in this case `correlation_id == request_id` is allowed.

Both fields can be set on the same frame. Both can be `null` if neither applies.

---

## 10. Timeouts

| What                         | Default | Configurable | Hard cap |
|------------------------------|---------|--------------|----------|
| REST `/commands` server-side wait for `command.ack` from executor | 2000 ms | no | n/a |
| Command total deadline (from accept to result) | 10000 ms | per-request `timeout_ms` | clamped to [1000, 60000] |
| WS handshake (`hello`→`welcome`) | 5000 ms | no | n/a |
| Heartbeat interval | 25000 ms | env `GHOSTYC_HEARTBEAT_MS` | 5000–60000 |
| Heartbeat timeout (offline marker) | 60000 ms | env `GHOSTYC_HEARTBEAT_TIMEOUT_MS` | ≥ 2× interval |
| WoL packet send | 1000 ms | no | n/a |

When a command timeout fires, the relay:
1. Sets the cached state to `timeout`.
2. Logs `event: command.timeout` with the `request_id`.
3. Sends a synthesized `command.result` with `state: "timeout"` to clients.
4. Does NOT cancel the executor — the agent may still finish later. A late-arriving `command.result` is logged with `event: command.result` but the cached state stays `timeout`.

---

## 11. Reconnect

### 11.1 Agent and bridge (outbound WS)

Two phases. Both apply jitter ±20% to the base delay.

**Phase A — capped exponential backoff** (attempts 1–10):

```
attempt 1:  1s
attempt 2:  2s
attempt 3:  4s
attempt 4:  8s
attempt 5: 16s
attempts 6–10: 30s   (cap)
```

**Phase B — degraded retry mode** (attempts 11+):

```
every 300s (5 minutes)   forever, until success or process exit
```

The device **never permanently stops retrying**. Indefinite retry is required
because the only way to recover a remote machine is for it to keep trying.

### 11.2 Logging policy for reconnect

Logging is bursty in Phase A and quiet in Phase B, so events are never lost
but the operator's logs are not flooded.

- **State transitions are always logged** (info or warn level):
  - `ws.connecting` — first attempt of a disconnect cycle
  - `ws.connected` — after successful `welcome`; resets attempt counter
  - `ws.disconnected` — with close code and reason
  - `ws.reconnect_scheduled` — Phase A only, every attempt, with `context: { attempt, delay_ms, phase: "exponential" }`
  - `ws.degraded_entered` — emitted once when transitioning from Phase A to Phase B (after attempt 10 fails), `level: "warn"`
  - `ws.degraded_exited` — emitted once when reconnecting from Phase B
- **Periodic summary in Phase B** (instead of one log per retry):
  - `ws.degraded_summary` — emitted **once per hour** while in Phase B with `context: { attempt, last_error, since: "<degraded_entered ts>" }`. Individual Phase B retry attempts are NOT logged.

This guarantees: every disconnect cycle has a clear start, end, and (if it
takes long) a summary trail, without producing thousands of identical
"reconnect attempt" lines.

### 11.3 Client (web/iPhone)

Same two-phase schedule. On reconnect, the client SHOULD call `GET /devices`
and `GET /logs/recent?since=<lastSeen>` to backfill state, then resume the
live `log.event` stream.

### 11.4 Relay

Relay is the central peer; it does not reconnect outward. On crash/restart,
it loses in-memory state (devices marked `unknown`, log buffer empty) and
accepts new `hello` frames as devices reconnect using the schedule above.

### 11.2 Client (web/iPhone)

Same schedule. On reconnect, the client SHOULD call `GET /devices` and `GET /logs/recent?since=<lastSeen>` to backfill state, then resume the live `log.event` stream.

### 11.3 Relay

Relay is the central peer; it does not reconnect outward. On crash/restart, it loses in-memory state (devices marked `unknown`, log buffer empty) and accepts new `hello` frames as devices reconnect.

---

## 12. Offline Behavior

V1 is strict: **no queueing**.

- If the agent is offline and a client posts an agent-targeted command → REST `409 command.target_offline`. The command is never queued.
- If the bridge is offline and a wake command arrives → same: `409 command.target_offline`.
- Logs from a disconnected agent/bridge are simply not received. The agent buffers them locally to file (§6.3) but does NOT replay them on reconnect in V1.
- Heartbeats during offline periods are not retroactively counted.

This is intentional. Queueing is a V2 feature behind a flag.

---

## 13. Commands (V1)

Argument schemas are normative. Unknown args are rejected with `request.invalid_args`.

### 13.1 Agent commands

`target: "agent"`.

| Command          | `args`                                  | Result `data.result` shape | Default `timeout_ms` |
|------------------|-----------------------------------------|----------------------------|----------------------|
| `status`         | `{}`                                    | `{ os, hostname, uptime_s, version }` | 5000 |
| `lock`           | `{}`                                    | `{ locked: true }`         | 5000 |
| `sleep`          | `{}`                                    | `{ scheduled: true }`      | 5000 |
| `shutdown`       | `{ "delay_s": 0 }` (optional, 0–600)    | `{ scheduled_at: "..." }`  | 5000 |
| `restart`        | `{ "delay_s": 0 }` (optional, 0–600)    | `{ scheduled_at: "..." }`  | 5000 |
| `open_app`       | `{ "path": "C:\\path\\to\\app.exe", "args"?: string[] }` OR `{ "name": "notepad", "args"?: string[] }` | `{ pid: 1234, mode: "path" \| "name" }` (see note) | 10000 |
| `open_website`   | `{ "url": "https://..." }`              | `{ opened: true }`         | 5000 |
| `list_processes` | `{ "limit": 50 }` (optional, 1–500)     | `{ processes: [{pid,name,cpu_percent,mem_mb}] }` | 10000 |
| `kill_process`   | `{ "pid": 1234 }` OR `{ "name": "x.exe" }` | `{ killed: [pid,...] }`  | 10000 |
| `screenshot`     | `{ "max_dimension"?: 1920, "quality"?: 80, "format"?: "jpeg" }` (all optional) | `{ image_b64, mime, width, height, bytes, max_dimension, quality }` | 15000 |

#### `screenshot` constraints (V1)

- **Format:** JPEG only in V1 (`"jpeg"`). PNG support is V2.
- **Encoding:** base64 inline in the `command.result` payload. There is **no streaming** of frames in V1 — one command, one still image, one result.
- **Quality:** default `80`, clamp `[40, 95]`.
- **Max dimension:** the longer side is scaled down preserving aspect ratio. Default `1920`, clamp `[320, 3840]`.
- **Max encoded bytes:** **1.5 MB** (1_572_864 bytes) hard cap on the base64 image bytes (pre-base64). If the encoded image exceeds the cap, the agent SHOULD reduce quality in steps (down to the lower clamp) and re-encode; if still over, it MUST return `error.code: "command.image_too_large"` rather than truncate or fake.
- **Result fields:** `image_b64` (base64 of the encoded JPEG), `mime` ("image/jpeg"), `width`, `height` (post-scale), `bytes` (encoded byte length), `max_dimension`, `quality` (the values actually used).
- **Multi-monitor:** capture the primary monitor only in V1.

`screenshot` MAY be marked `not_implemented` in Phase 2 if a clean implementation is not feasible (e.g. session-0 isolation issues when running as a Windows service). In that case the agent returns `error.code: "command.not_implemented"` with a one-line explanation. It is NEVER faked.

#### `open_app` — pid semantics

- `mode: "path"` → `pid` is the actual spawned process. Use this if you intend to follow up with `list_processes` or `kill_process`.
- `mode: "name"` → the agent invokes `cmd.exe /c start "" <name>`, which delegates to Windows' App Paths registry / file association resolver. The returned `pid` is `cmd.exe`'s, which usually exits within milliseconds of launching the real target. In this mode `pid` is honest about being the launcher, not the launched app — the agent does not fabricate the target's pid because finding it reliably has race conditions (multiple instances, slow-starting apps).

### 13.2 Bridge commands

`target: "bridge"`.

| Command   | `args`                                                            | Result `data.result` shape | Default `timeout_ms` |
|-----------|-------------------------------------------------------------------|----------------------------|----------------------|
| `wake_pc` | `{ "mac"?: "AA:BB:CC:DD:EE:FF", "broadcast"?: "192.168.1.255", "port"?: 9 }` (all optional, defaults from `PC_MAC_ADDRESS` / `PC_BROADCAST_ADDRESS`) | see below | 120000 (clamp [10000, 300000]) |
| `status`  | `{}`                                                              | `{ uptime_s, version, wifi: {...}|null }` | 5000 |

#### `wake_pc` — relay-orchestrated

`wake_pc` always targets the **bridge** (`target: "bridge"`). If the bridge is offline at the time the REST call is made, the relay returns HTTP 409 with `command.target_offline` and never dispatches.

The lifecycle is two-stage and is orchestrated by the relay:

1. **Stage 1 — bridge sends the packet.** Relay forwards `command.dispatch` to the bridge. The bridge sends the magic packet within 1 s and responds with `command.result` carrying `{ packet_sent: true, packet_bytes: 102 }`. The relay does NOT yet forward this to clients — it treats it as the Stage 1 confirmation.
   - If the bridge fails to send the packet, the relay forwards `state: "failed"` to clients immediately with the bridge's error and skips Stage 2.
2. **Stage 2 — wake watch.** The relay starts a "wake watch" timer (`timeout_ms - elapsed`). The PC is presumed to boot and the Windows agent is presumed to reconnect. The relay considers Stage 2 complete when:
   - the agent's WS goes from `offline` → `online` (transition observed via `device.status_changed`) and at least one heartbeat has been received, OR
   - the wake watch timer expires.
3. **Final `command.result` to clients** has this shape:

```json
{
  "state": "success",          // success if agent came online, "timeout" if not
  "started_at": "...",
  "finished_at": "...",
  "duration_ms": 35420,
  "result": {
    "packet_sent": true,
    "packet_bytes": 102,
    "agent_came_online": true,
    "agent_online_at": "2026-05-08T12:00:35.420Z",
    "wait_duration_ms": 35420
  },
  "error": null
}
```

If `agent_came_online` is `false`, `state` is `"timeout"`, `agent_online_at` is `null`, and `error` is set to `{ code: "wake.agent_no_show", message: "WoL packet sent but agent did not reconnect within timeout_ms" }`. `packet_sent` remains `true` because the bridge did its job — the failure is observed boot, not the wake itself.

The bridge does NOT verify the PC actually woke up. Only the relay's wake watch does, and only by observing the agent reconnect. There is no ICMP / port probe in V1.

While Stage 2 is in flight, clients see one progress hint: the relay emits `event: "wake.watching"` (correlation_id = request_id) when Stage 2 starts, and `event: "wake.watch_resolved"` when it ends. These appear in `log.event` but no separate WS message type is added.

---

## 14. Config Validation

Every component validates env on boot and emits one log event:
- success → `event: "boot", level: "info"`
- failure → `event: "config.invalid", level: "error"` with the missing key name in `context.missing_keys`, then exits with code `2`.

Required env vars per component:

**Relay**
- `GHOSTYC_CLIENT_TOKEN`, `GHOSTYC_AGENT_TOKEN`, `GHOSTYC_BRIDGE_TOKEN`, `GHOSTYC_ADMIN_PASSWORD`
- `PORT` (Railway provides)
- Optional: `GHOSTYC_LOG_BUFFER_SIZE`, `GHOSTYC_HEARTBEAT_MS`, `GHOSTYC_HEARTBEAT_TIMEOUT_MS`

**Agent**
- `GHOSTYC_AGENT_TOKEN`, `RELAY_URL`, `PC_NAME`

**Bridge**
- `GHOSTYC_BRIDGE_TOKEN`, `RELAY_URL`, `PC_MAC_ADDRESS`, `PC_BROADCAST_ADDRESS`

**Web / iPhone**
- `RELAY_URL` (build-time or in-app setting)

---

## 15. Versioning

- `protocol_version` is included in `welcome` and `/health`.
- Components MUST verify the relay's `protocol_version` matches their own at handshake. On mismatch, log `event: "protocol.mismatch", level: "error"` and disconnect with WS close `4400`.
- During V1, all components ship `1.0.0-draft`. The first non-draft is `1.0.0`. Breaking changes bump the major.

---

## 16. What is explicitly NOT in V1

To prevent scope creep, the following are out of spec for V1 and any implementation that adds them violates the project rules:

- Command queueing for offline devices
- Push notifications
- Scheduled commands
- Multi-PC support (`target` is implicitly singular)
- File transfer
- Remote desktop / streaming
- Audio control beyond what is listed
- Whitelists / confirmations / ACL
- Rate limiting beyond the auth attempt counter
- Any database (in-memory ring buffer only)
- Android bridge

All of the above are V2 candidates and require a spec update before implementation.
