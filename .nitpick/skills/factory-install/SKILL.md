---
name: factory-install
description: "Builds and installs the `sf` binary and web UI from a checkout, onboards a git repository, and starts server, web and Cell. ONLY activate when explicitly requested by the user (e.g., 'use factory-install', 'install sf', 'set up the factory on this machine'). Never activate automatically."
---

# Factory Install

## Activation (Explicit Only)

Never activate automatically. Only when user asks to install `sf`, onboard a repo, or start server/web/Cell.

## Rules

- Ask before writing outside the repo or overwriting existing config.
- Never print or store tokens, credentials or `gh` auth data. Never log in for the user (`gh auth login` etc.: tell user to run it).
- Never commit, push or open a PR unless asked.
- Do not guess paths or repo URL: ask, or read from env/`git remote`.
- Reference: `README.md` (Install, Use `sf`), `docs/sf.md`.

## 1. Prerequisites

Check each, report missing, do not install silently:

```bash
bun --version && git --version
gh auth status        # must be logged in; never print token
herdr --version
```

Line runners, at least one: `claude`, `agy`, `cursor-agent`, `opencode` (`command -v <name>`).

## 2. Build and install

From the factory checkout:

```bash
bun install
bun run build:sf                           # apps/sf/dist/sf + web UI
```

Remove stale symlink first (a link to an old build shadows the install):

```bash
ls -l ~/.local/bin/sf 2>/dev/null          # if symlink, rm ~/.local/bin/sf
```

Install, one of:

```bash
sudo scripts/install.sh                    # /usr/local/bin/sf, /usr/local/share/sf/web
PREFIX="$HOME/.local" scripts/install.sh   # no sudo
export SF_WEB_DIR="$HOME/.local/share/sf/web"   # needed at runtime for the no-sudo prefix
```

`PREFIX`, `DESTDIR`, `SF_WEB_DIR` override targets. Verify: `sf --help`, `command -v sf`.

## 3. Onboard a repository

Any git repo, not only this monorepo:

```bash
cd path/to/repo
sf init                                    # .factory/ + .gitignore entries
sf hq start                                # one HQ server per machine
sf hq token admin create --save            # .factory-local/operator.token
sf project add <id> --repo <url>
sf web start                               # optional; http://127.0.0.1:4321
sf hq token create --kind factory_join --name <name>   # once per PC, prints the join token
sf factory connect <hq-url> --token -     # join token from stdin, once per PC
sf factory start
sf cell scale 2 --repo <path>              # Cells start under the Factory daemon
sf todos import                            # push todos/*.md
sf queue
```

- Pass the join token with `--token -` (stdin); do not echo it.
- Repeat `sf init`, `sf project add`, `sf cell scale N --repo <path>` per repo to share one HQ.

## 4. Multi-cell and remote brain

- Several Cells on one PC: `sf cell scale N`, one count per repo project.
- Remote HQ: start with `FACTORY_HOST=0.0.0.0` only behind Tailscale or TLS. Remote Factories join with `sf factory connect <hq-url>` and a `factory_join` token.
- Data dir: `$XDG_DATA_HOME/sf` (default `~/.local/share/sf`).

## 5. Verify and stop

```bash
sf queue
sf cell list
sf web stop
sf cell scale 0 --repo <path>              # stops this repo's Cells
sf factory stop
sf hq stop
```

Report to user: what is installed where, what is running, anything skipped.
