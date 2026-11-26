# `sf` CLI (`apps/sf`)

Single compiled binary serving Supervisor commands, embedded HQ server (`sf hq`), Factory daemon (`sf factory`), Cell daemon (`sf cell`), and agent loopback client (`sf operator`).

- Terms: [glossary](../README.md#glossary)
- Factory & Cell lifecycle: [cells-and-factory.md](../features/cells-and-factory.md)
- Operator client: [operator.md](./operator.md)
- Server design: [hq.md](./hq.md)

## 1. Install & Quickstart

`bun run build:sf` compiles `apps/sf/dist/sf` (embeds HQ server, init templates, SQL migrations) and builds web UI:

```bash
bun install && bun run install:sf         # ~/.local/bin/sf + ~/.local/share/sf/web
```

Quickstart in any git repo:

```bash
cd path/to/repo
sf init                                   # .factory/ + .gitignore entries
sf hq start
sf hq token admin create --save           # .factory-local/supervisor.token
sf project add my-project --repo <url>
sf web start                              # http://127.0.0.1:4321
sf factory connect <hq-url> --token <factory_join>
sf cell scale 2 --repo ~/code/my-project
sf order import && sf queue
```

## 2. Command Tree

| Group | Command | Caller | Target Endpoint |
| :--- | :--- | :--- | :--- |
| `init` | `sf init` | Supervisor (in repo) | local `.factory/`, `.gitignore` |
| `setup` | `sf setup` / `sf doctor` | Supervisor (in repo) | checks tools, runs `init`, `hq start`, `project add` |
| `project` | `sf project add <id> --repo <url>` / `ls` | Supervisor | `POST` / `GET /api/v1/projects` |
| `hq` | `sf hq start \| stop` | Supervisor | spawns/stops embedded HQ server |
| `hq` | `sf hq token admin create [--save] [--global]` | Supervisor | direct admin path in HQ |
| `hq` | `sf hq token create --kind factory_join --name <n>` | Supervisor | `POST /api/v1/tokens` |
| `factory` | `sf factory connect <url> --token <join\|->` | Supervisor (once/PC) | `POST /api/v1/factories/enroll` |
| `factory` | `sf factory start \| stop \| status` | Supervisor | Factory daemon `127.0.0.1:7072` |
| `web` | `sf web start \| stop \| status` | Supervisor | spawns installed web UI (`web.pid`) |
| `cell` | `sf cell scale N [--repo <path>] [--lines <names>]` | Supervisor | Factory daemon `PUT /scale` |
| `cell` | `sf cell list` | Supervisor | Factory daemon `GET /scale` |
| `cell` | `sf cell start [--name <slug>]` | Factory daemon child | Factory relay `/relay/api/v1/*` |
| `queue` | `sf queue [pause\|unpause\|reprioritise\|reset\|cancel]` | Supervisor | `GET /api/v1/work-orders`, `POST /api/v1/queue/actions` |
| `plan` | `sf plan list \| show \| activate \| retry <slug>` | Supervisor | `GET` / `POST /api/v1/order-plans*` |
| `order` | `sf order import \| export [--dir <path>]` | Supervisor | `POST /api/v1/queue/import`, `GET /api/v1/queue/export` |
| `order` | `sf order show \| resume \| reopen \| cancel <id>` | Supervisor | `GET` / `POST /api/v1/work-orders/{id}*` |
| `order` | `sf order test [--line <name>] [--slug <slug>]` | Supervisor | `POST /api/v1/work-orders` (smoke-test order) |
| `incident` | `sf incident list \| resolve <id> --action ...` | Supervisor | `GET` / `POST /api/v1/incidents*` |
| `watch` | `sf watch` | Supervisor | `GET /api/v1/stream` (SSE) |
| `operator` | `sf operator done \| verdict \| block \| context \| read \| incident` | Agent in Job | Cell loopback `$FACTORY_OPERATOR_URL` ([operator.md](./operator.md)) |

### Deprecated Names

Old aliases print `deprecated: use "sf hq <sub>"` (or `sf order <sub>`) to stderr and forward:
- `sf server start|stop|token create` -> `sf hq start|stop|token admin create`
- `sf connect` / `sf target` / `sf token create` -> `sf hq connect|target|token create`
- `sf todos import|export` -> `sf order import|export`

## 3. HQ Connection Resolution

| Setting | Resolution Order (First Wins) | Legacy Fallback |
| :--- | :--- | :--- |
| URL | `HQ_URL` -> active saved target -> `http://127.0.0.1:7070` | `FACTORY_URL` |
| Token | `HQ_TOKEN` -> `.factory-local/supervisor.token` -> active saved target -> `~/.config/factory/token` | `FACTORY_TOKEN` |

## 4. Production Lines (`.factory/lines/<line>.yml`)

| Line | Runner / Model | Stations | Use Case |
| :--- | :--- | :--- | :--- |
| `gemini` | `antigravity` (`gemini-3.8-flash-medium`) | `build` -> `quality-gate` -> `deliver` | Direct Gemini builder + quality gate |
| `fast` | `claude` (`haiku`) | `build` -> `quality-gate` -> `deliver` | Chores, docs, small fixes |
| `standard` | `claude` (`haiku`), `antigravity` | `build` -> `quality-gate` -> `audit` (`doctor`) -> `deliver` | Direct build + doctor audit |
| `feature` | `claude` (`sonnet`) | `plan` -> `build` -> `quality-gate` -> `audit` -> `deliver` | Full planned feature workflow |

Runners supported: `claude`, `codex`, `cursor`, `antigravity`, `opencode`, `copilot`.

## 5. Architecture Layout

Follows [engineering.md](../architecture/engineering.md) (`domain -> contracts -> application (ports + procedures) -> adapters -> bootstrap`):

```text
apps/sf/src/
├── cli.ts                    # citty entrypoint
├── config.ts                 # paths, ports, timing (25s claim, 10s heartbeat, 45s self-fence)
├── domain/                   # pure rules (zero I/O)
├── contracts/                # operator.contract.ts (HQ shapes from @repo/hq-contracts)
├── application/              # core/procedure, ports/*, procedures/*
├── adapters/                 # cli/, http/, fs/, git/, process/, runners/, operator-endpoint/, operator-client/
├── factory/                  # Factory daemon: supervisor, scaler, relay, hq-link, routes
├── cell/                     # Cell heartbeat helper
└── bootstrap/                # context.ts, hq-env.ts, run.ts, entry-dispatch.ts
```

## 6. Exit Codes

| Code | Meaning |
| :--- | :--- |
| `0` | Success |
| `1` | HQ or Cell refused (`400`, `401`, `403`, `409`, `500`) |
| `2` | Bad CLI arguments, missing env var, or unreadable file (nothing sent) |
| `3` | HQ, Factory daemon, or Cell endpoint unreachable |
