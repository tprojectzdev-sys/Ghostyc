# Ghostyc Setup (V1)

This setup guide is for local development and self-hosted personal use.

## 1) Prerequisites

- Node.js 20+
- npm 10+
- Windows machine for `apps/agent`
- Linux Mint (or any Linux host on the same LAN as the PC) for `apps/wol-bridge`

## 2) Install dependencies

From repo root:

```bash
npm install
```

## 3) Configure environment files

### Relay (`apps/relay/.env`)

Required:

- `GHOSTYC_CLIENT_TOKEN`
- `GHOSTYC_AGENT_TOKEN`
- `GHOSTYC_BRIDGE_TOKEN`
- `GHOSTYC_ADMIN_PASSWORD`
- `PORT` (default `8080`)

Rules:

- Client/agent/bridge tokens must all be different.
- Admin password must not equal any token.

### Agent (`apps/agent/.env`)

Required:

- `GHOSTYC_AGENT_TOKEN` (must equal relay's agent token)
- `RELAY_URL` (for local dev usually `ws://localhost:8080`)
- `PC_NAME` (e.g. `Tokyo-PC`)

Optional:

- `GHOSTYC_AGENT_LOG_DIR` (default `./logs`)

### WoL Bridge (`apps/wol-bridge/.env`)

Required:

- `GHOSTYC_BRIDGE_TOKEN` (must equal relay's bridge token)
- `RELAY_URL` (usually `http://localhost:8080` in local dev)
- `PC_MAC_ADDRESS` (target PC NIC MAC)
- `PC_BROADCAST_ADDRESS` (LAN broadcast address, e.g. `192.168.1.255`)

Optional:

- `GHOSTYC_BRIDGE_LOG_DIR` (default `./logs`)

### Web (`apps/web/.env` optional)

`VITE_RELAY_URL` may be empty for local dev because Vite proxies to `http://localhost:8080`.

## 4) Start services

Use separate terminals from repo root:

```bash
npm run dev:relay
npm run dev:agent
npm run dev:bridge
npm run dev:web
```

Open web at `http://localhost:5173`.

## 5) Login

Use `GHOSTYC_ADMIN_PASSWORD` (from relay env) on the web login page.

The relay returns `GHOSTYC_CLIENT_TOKEN`, then web stores it in `localStorage`.

## 6) Verify health quickly

1. `GET /health` returns `status: "ok"`.
2. `GET /devices` shows connected `agent` and/or `bridge`.
3. `POST /commands` with `target=agent`, `command=status` should reach `success`.
4. `POST /commands` with `target=bridge`, `command=status` should reach `success`.

## 7) Wake-on-LAN behavior

`wake_pc` is two-stage:

1. Bridge sends magic packet.
2. Relay waits for agent reconnect (wake watch) until timeout.

Final result is:

- `success` if agent comes online in time
- `timeout` + `wake.agent_no_show` if packet sent but agent never reconnects

