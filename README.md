# Ghostyc

Private personal remote PC control for one user.

> Control my Windows PC from anywhere via iPhone, web, a Railway relay, a Windows
> agent, and a Linux Mint Wake-on-LAN bridge. Not SaaS. Not multi-user. Not AI.
> Personal, private, reliable, observable.

This repo is the source of truth for Ghostyc. The protocol is frozen first
(see [`docs/PROTOCOL.md`](docs/PROTOCOL.md)), then components are built phase
by phase against that protocol.

---

## Status

**Phase 5 complete.** Linux Mint WoL bridge wired in; the full ecosystem
(relay + agent + web + iPhone + bridge) speaks the same protocol end-to-end.

| Phase | What | State |
|-------|------|-------|
| 0 | Protocol + repo structure + phase plan | done |
| 1 | Relay + Windows agent minimal pipe (status command end-to-end) | done |
| 2 | Real Windows commands (lock, sleep, shutdown, restart, open_app, open_website, list/kill processes, screenshot — `command.not_implemented` if AV blocks) | done |
| 3 | Web dashboard wired to real backend data | done |
| 4 | iPhone SwiftUI app + GitHub Actions IPA build, live WS UI | done |
| 5 | Linux Mint WoL bridge + relay-orchestrated `wake_pc` two-stage lifecycle | done |
| 6 | Reliability polish + README/troubleshooting | in progress |

Each phase produces something real, testable, and functional before moving on.
No phase is scaffolded ahead of time.

---

## Architecture

Main control path:

```
iPhone / Web Dashboard
        │  REST commands + WebSocket realtime
        ▼
Railway Relay  (auth, route, log, status)
        │  WebSocket
        ▼
Windows Agent  (executes commands)
        │
        ▼
Windows PC
```

Wake path (PC is off, so the agent isn't reachable):

```
iPhone / Web Dashboard
        │  REST wake command
        ▼
Railway Relay
        │  WebSocket
        ▼
Linux Mint WoL Bridge
        │  UDP magic packet (LAN)
        ▼
Windows PC powers on  →  Agent reconnects to Railway
```

Roles are strict:
- **Relay** authenticates and routes. It does not execute PC commands.
- **Agent** executes PC commands. Connects outbound to relay.
- **Bridge** sends WoL packets only. Connects outbound to relay.
- **Clients** (web + iPhone) talk to the relay only, never directly to agent or bridge.

Full contract is in [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

---

## Repo layout

```
ghostyc/
├─ apps/
│  ├─ relay/              # Node.js + TypeScript Railway backend (Phase 1)
│  ├─ agent/              # Node.js + TypeScript Windows agent (Phase 1)
│  ├─ web/                # React + Vite dashboard (Phase 3, uses provided Figma UI)
│  ├─ ios/                # SwiftUI iPhone app (Phase 4)
│  └─ wol-bridge/         # Linux Mint WoL bridge (Phase 5)
├─ packages/
│  └─ protocol/           # Shared types/schemas derived from PROTOCOL.md
├─ docs/
│  └─ PROTOCOL.md         # Frozen wire contract (Phase 0)
├─ .github/
│  └─ workflows/          # CI, including iOS IPA build (Phase 4)
└─ Ghostyc_UI_Design(Figma)/  # Provided dashboard design — DO NOT redesign
```

`SETUP.md` and `TROUBLESHOOTING.md` are intentionally not created yet — they will
appear in Phase 6 when there is something real to document.

---

## Phase plan

### Phase 0 — Spec first (this phase)
- [x] `docs/PROTOCOL.md` covering REST, WebSocket envelope, command schemas, log
      schema, heartbeat, device status, error codes, auth, request_id /
      correlation_id rules, timeouts, reconnect, offline behavior.
- [x] Empty monorepo structure under `apps/`, `packages/`, `docs/`,
      `.github/workflows/`.
- [x] This README with the full phase plan.
- [x] No implementation code.

### Phase 1 — Relay + Agent minimal pipe
- Stand up the Railway relay (Node + TS, Fastify or Express, `ws`).
- Stand up the Windows agent (Node + TS).
- Agent connects outbound to the relay over WebSocket and authenticates with
  `GHOSTYC_AGENT_TOKEN` per [`docs/PROTOCOL.md` §4.3](docs/PROTOCOL.md).
- Heartbeats every 25s, relay marks offline at 60s.
- Implement `status` command end-to-end:
  client → `POST /commands` → relay → agent → `command.result` → client (WS).
- Logs include `request_id` end-to-end.
- `GET /health`, `GET /devices`, `GET /diagnostics` return real data.
- Auth: `POST /auth/login`, `GET /auth/whoami`.

### Phase 2 — Real Windows commands
Add commands one at a time, each tested before the next:
1. `lock`, `sleep`
2. `shutdown`, `restart`
3. `open_app`, `open_website`
4. `list_processes`, `kill_process`
5. `screenshot` — only if it doesn't destabilize V1; otherwise return
   `command.not_implemented`. Never faked.

### Phase 3 — Web dashboard wired to real data
- Use the existing UI in `Ghostyc_UI_Design(Figma)/` exactly as designed.
- Replace every placeholder/static value with live relay data.
- Auth via `POST /auth/login`, store client token in localStorage.
- Live logs and device status over WebSocket; REST for commands and history.
- Serve the built dashboard from the relay if practical.

### Phase 4 — iPhone app
- SwiftUI, tabs: Home / Commands / Apps / Logs / Diagnostics / Settings.
- Same REST + WS protocol as web.
- GitHub Actions workflow that produces an IPA artifact on push.
- Premium dark Ghostyc style. No installation docs (the user already knows).

### Phase 5 — Linux Mint WoL bridge
- Simple Node.js (or Python) service.
- Outbound WS to relay, authenticates as `bridge`.
- Receives `wake_pc` command, sends UDP magic packet to `PC_BROADCAST_ADDRESS`.
- Logs and reports bridge status to relay (visible in Diagnostics).

### Phase 6 — Reliability polish
- Reconnect edge cases, heartbeat timeouts, command timeouts.
- Log rotation for agent and bridge.
- Config validation hardening.
- Better error messages.
- `docs/SETUP.md` and `docs/TROUBLESHOOTING.md`.
- No new features.

---

## Development rules (enforced for every phase)

- Work strictly phase by phase. Stop at the end of each phase, summarize, list
  how to test, list known limitations, list assumptions, wait for approval.
- No fake data. If something is offline, show offline. If unknown, show unknown.
  If not implemented, mark not implemented.
- No mocked systems pretending to work. No placeholder implementations called
  complete.
- Every component validates required env vars on boot (see PROTOCOL §14) and
  fails clearly if anything is missing.
- All logs are structured (PROTOCOL §6). Console output uses the same shape.
- Every command carries a `request_id` end-to-end. Every related log entry
  carries the same `request_id`.
- No queueing for offline devices in V1. Reject with `command.target_offline`.
- Don't scaffold future phases early.

---

## Out of scope for V1

See [`docs/PROTOCOL.md` §16](docs/PROTOCOL.md). Anything not listed in the phase
plan above is V2 or later.
