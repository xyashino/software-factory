# software-factory

Monorepo hosting **SoftwareFactory** ([docs](docs/README.md): [architecture](docs/architecture.md), [sf](docs/sf.md), [hq](docs/hq.md)), an autonomous AI harness that turns
`todos/*.md` work orders into verified Pull Requests via declarative production lines.

## Main idea

The system is modeled as an automated software factory:

- **HQ** (external server) is the single control point holding blueprints (Lines, Stations, Operators), the schedule, **Traveler** records (append-only event logs), and the board.
- **Factory** (local daemon, one per PC) is the only holder of the HQ credential. It spawns, supervises and kills Cells.
- **Cells** are disposable workers that connect outbound to HQ, claim a **Job** for a **Station**, execute it, push git checkpoints and artifacts, and can disconnect at any time without losing completed work.
- **Lines** are declarative production workflows composed of **Stations**—either an **Operator** (an AI specialist such as `planner`, `builder`, `reviewer`, `auditor`) or an **Inspection** (a deterministic command gate).
- **Work orders** (`todos/*.md`) travel down a Line from station to station. If an Operator or Inspection hits a blocker, it raises an **Andon** (releasing the Cell immediately) with a **Handover** so a human supervisor can resolve it and resume on any available Cell.

| Package                      | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `apps/sf`                    | `sf`: the single CLI binary (server, Cell, Supervisor commands, local Factory daemon) |
| `apps/hq`                    | HQ HTTP server and storage                                      |
| `apps/web-demo`              | Web UI served by `sf web start`                                 |
| `packages/nitpick`           | Rules/skills engine; generates `.agents/` from `.nitpick/`      |
| `packages/prompt`            | Prompt building blocks                                          |
| `packages/eslint-config`     | Shared ESLint config                                            |
| `packages/typescript-config` | Shared tsconfig presets                                         |

## Prerequisites

- [mise](https://mise.jdx.dev/): `mise install` (Node 24, Bun 1.4.4)
- [Bun](https://bun.sh/) 1.4.4: package manager and script runner (the factory runs on Bun)
- `herdr`, `gh` and the agent CLIs used in `.factory/lines/*.yml`

## Development

```bash
bun install
bun run ci:verify    # format, lint, typecheck, test, build
```

## Install `sf`

`sf` is one standalone binary (server, init templates and migrations embedded) plus the web UI. Install a prebuilt release with no Node or Bun (Linux x64/arm64, macOS arm64):

```bash
curl -fsSL https://raw.githubusercontent.com/xyashino/software-factory/main/scripts/install-release.sh | sh   # ~/.local/bin/sf, ~/.local/share/sf/web
```

The script checks each asset against `SHA256SUMS` before it writes anything. `SF_VERSION=v1.2.3` pins a tag, `PREFIX` changes the install root. `SHA256SUMS` covers the release assets, not the script.

Or build and install from this checkout, as your user, with no admin rights needed.

Linux:

```bash
bun install && bun run install:sf       # ~/.local/bin/sf, ~/.local/share/sf/web
```

Windows 10 (PowerShell):

```powershell
bun install; bun run install:sf         # %LOCALAPPDATA%\sf\bin\sf.exe, %LOCALAPPDATA%\sf\web
```

`bun run install:sf` runs `bun run build:sf`, then `node scripts/install.mjs`. If the install directory is not on `PATH`, the script prints the line to add. Options: `--prefix <dir>` (installs to `<dir>/bin` and `<dir>/share/sf/web`), `--source <dir>` (directory holding the built `sf`), `--web-dir <dir>`; env `PREFIX`, `DESTDIR` and `SF_WEB_DIR` work the same way.

System-wide Linux install: `bun run build:sf && sudo scripts/install.sh` (`/usr/local/bin/sf`, `/usr/local/share/sf/web`; `PREFIX` and `DESTDIR` override the targets).

State lives in `$XDG_DATA_HOME/sf` (default `~/.local/share/sf` on Linux, `%LOCALAPPDATA%\sf` on Windows).

## Set up a VPS (headless)

Fresh Linux VPS, SSH only, no desktop. Run everything as your normal user, not root.

Prerequisites:

- Git, `mise` (Node 24, Bun 1.4.4).
- `gh auth login` done: `sf setup` warns until PR delivery can use `gh`.
- Runner CLIs named in `.factory/lines/*.yml` on `PATH` (starter lines use `claude`).
- `herdr` only if a line has a non-headless station; `sf doctor` says when.

Install from a checkout:

```bash
git clone <repo-url> software-factory && cd software-factory
mise install && bun install
bun run build:sf                                  # apps/sf/dist/sf + web UI
node scripts/install.mjs --source apps/sf/dist    # ~/.local/bin/sf (see troubleshooting)
export PATH="$HOME/.local/bin:$PATH"
```

Set up the repo the factory will work on:

```bash
cd path/to/your-repo
sf doctor                 # read-only check: git, gh, runners, server, token, project
sf setup                  # doctor, init, hq start, project add (idempotent)
sf todos import --dry-run # preview todos/*.md before pushing
```

`sf setup` refuses until every runner is installed. The repo needs a git `origin` for the project step; setup fails there, after init and server start.

Log in to each runner CLI on the VPS: run it once in your SSH session, as the same user that runs `sf`, and finish its sign-in. `sf doctor` only checks that the binary is on `PATH`.

Web UI from your laptop, without opening a port on the VPS:

```bash
sf web start                              # VPS, 127.0.0.1:4321
ssh -L 4321:127.0.0.1:4321 <user>@<vps>   # laptop
# open http://127.0.0.1:4321 on the laptop
```

HQ listens on loopback by default. Set `HQ_HOST` (for example a Tailscale address) only behind Tailscale or TLS: it exposes the HQ API to the network.

Keep HQ running after you log out. On Linux, `sf service install` writes systemd user units for the server; `sf service uninstall` removes them.

Troubleshooting:

| Symptom | Check | Fix |
| --- | --- | --- |
| Port 7070 in use: `sf hq start` prints `server started`, or `sf doctor` shows `token rejected` on an HQ you did not start | `ss -ltnp 'sport = :7070'`: owner is not your HQ server | Stop the owner: `kill <pid>`. `sf hq stop` only stops the process in the pid file, not a leaked one. Then `sf hq start` |
| 401 after `sf hq token admin create`: `401: Missing or invalid bearer token` | Read `token source:` in the error. The `fix:` line for a saved target still prints the older `sf server token create --global` spelling, which is the same command | `repo:.factory-local/supervisor.token`: `sf hq token admin create --save` (the repo file wins over global). `env:HQ_TOKEN` (or `env:FACTORY_TOKEN`): unset it or set the new token. `config:<name>`: `sf hq token admin create --save --global` |
| Missing runner: `missing: runner <name> not installed` in `sf doctor`; `sf setup` refuses | `command -v <name>` prints nothing | Install the CLI, put it on `PATH` for non-login shells too, sign in (see above), then `sf doctor` |

Test runs on the same VPS: set `HQ_PORT` and `HQ_URL` together, or the probe and the doctor check still hit port 7070.

## Use `sf` in any repository

Works in any git repository, not only this monorepo:

```bash
cd path/to/repo
sf init                                    # .factory/ and .gitignore entries
sf hq start                                # one HQ server per machine
sf hq token admin create --save            # .factory-local/supervisor.token
sf project add my-project --repo <url>
sf web start                               # dashboard at http://127.0.0.1:4321; sf web stop to end
sf factory connect <hq-url> --token <factory_join>         # once per PC
sf cell scale 2 --repo ~/code/my-project                   # Cells start under the Factory daemon
sf todos import && sf queue                # push todos/*.md, see the queue
sf hq stop
```

Run `sf init`, `sf project add` and `sf cell scale N --repo <path>` in each repository to share one server across repositories. Command reference: [docs/sf.md](docs/sf.md). The flow is proved end to end by `apps/sf/test/blackbox/standalone-external-repo.test.ts` (runs after `bun run build:sf`, skipped without build output).

## Credits

Inspired by [gon-stack](https://github.com/polubis/gon-stack/tree/main).
