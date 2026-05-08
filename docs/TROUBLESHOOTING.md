# Ghostyc Troubleshooting (V1)

## Web says: "Authentication failed. Check your password."

This message can be caused by two different issues:

1. Wrong `GHOSTYC_ADMIN_PASSWORD`
2. Relay unreachable from web dev server

How to differentiate:

- If Vite terminal shows proxy errors like `ECONNREFUSED` for `/auth/login`, relay is not running/reachable.
- If relay is running and `/auth/login` returns 401, password is wrong.

Fix:

1. Start relay (`npm run dev:relay`)
2. Confirm password in `apps/relay/.env`
3. Retry login

## Vite proxy errors (`/auth/login`, `/devices`, etc.)

Symptoms:

- `http proxy error`
- `AggregateError [ECONNREFUSED]`

Cause:

- Web (`5173`) cannot connect to relay (`8080`)

Fix:

- Start relay first
- Ensure relay uses `PORT=8080` (or update web proxy config accordingly)

## `command.target_offline` responses

Cause:

- Target role is currently disconnected:
  - `target: "agent"` -> agent offline
  - `target: "bridge"` -> bridge offline

Fix:

- Start target process (`npm run dev:agent` or `npm run dev:bridge`)
- Re-check `GET /devices`

## `wake_pc` times out with `wake.agent_no_show`

Meaning:

- Bridge sent packet successfully, but relay did not observe agent reconnect within timeout.

Checks:

1. BIOS/UEFI Wake-on-LAN enabled
2. NIC power settings allow WoL
3. Correct `PC_MAC_ADDRESS`
4. Correct `PC_BROADCAST_ADDRESS` for PC subnet
5. Bridge host is on the same reachable LAN segment
6. Agent auto-start on PC boot

## Bridge not connecting (`/ws/bridge`)

Checks:

1. `GHOSTYC_BRIDGE_TOKEN` matches relay
2. `RELAY_URL` is correct
3. Relay is reachable from bridge host network

Logs to inspect:

- Bridge events: `ws.connecting`, `ws.reconnect_scheduled`, `ws.degraded_entered`, `ws.connected`
- Relay events: `auth.failed`, `protocol.mismatch`, `ws.connected`

## Agent not connecting (`/ws/agent`)

Checks:

1. `GHOSTYC_AGENT_TOKEN` matches relay
2. `RELAY_URL` correct
3. Firewall allows outbound websocket traffic

Logs to inspect:

- Agent events: `ws.connecting`, `ws.error`, `ws.reconnect_scheduled`, `ws.connected`
- Relay events: `auth.failed`, `ws.connected`, `device.status_changed`

## `command.timeout`

Meaning:

- Command was accepted and dispatched but no final result arrived before timeout.

Typical causes:

- Command process hung on target
- Target disconnected mid-command
- Timeout too low for that command

Fix:

- Inspect target logs around same `request_id`
- Retry with a larger `timeout_ms` where supported

## Config invalid on boot (`event: "config.invalid"`)

Cause:

- Missing or invalid env values.

Common examples:

- Missing token/password
- Duplicate tokens (client/agent/bridge must differ)
- Admin password equals one of the tokens
- Heartbeat timeout less than `2 * heartbeat interval`

Fix:

- Correct `.env` values and restart service.

