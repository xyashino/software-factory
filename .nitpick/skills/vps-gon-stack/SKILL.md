---
name: vps-gon-stack
description: >
  Debian 13 VPS full setup via one script (main.sh) run after first root ssh login: key-only ssh,
  root packages, Docker, gh, Playwright libs, firewall, factory user + rootless Docker,
  GitHub token (gh), factory tooling (mise, Node, pnpm, repo, Playwright browser, herdr, Claude Code, opencode, Cursor CLI, Antigravity CLI),
  software factory timer (systemd).
  Use when user says "vps setup", "debian 13 vps", "harden ssh", "disable ssh password",
  or invokes /vps-gon-stack.
---

# VPS Debian 13

Basic path: 2 manual steps (key + first login), then [scripts/main.sh](scripts/main.sh) does everything else.

## 1. Before main.sh (manual, local)

1. Make ssh key on your machine (not VPS). SET PASSPHRASE.

```powershell
# New ssh key
ssh-keygen -t ed25519 -C "somemail@gmail.com" -f "$env:USERPROFILE\.ssh\id_ed25519_new"
# Pub key to clipboard
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_new.pub" | Set-Clipboard
```

2. Paste pub key into VPS provider panel.

3. First login with the key. Confirm fingerprint "yes" only if IP/domain valid, else STOP.

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_new" root@1.1.1.1
```

## 2. Run main.sh

Runs in order, stops on first error, re-run safe (connection dropped = run again):

- **A** ssh hardening: key-only login (`harden-ssh.sh`)
- **B** root setup: packages, Docker, gh, Playwright libs, firewall (`setup-root.sh`)
- **C** `factory` user + rootless Docker (`setup-factory.sh`)
- **D** as `factory`: GitHub access first (`setup-git.sh`). No token yet: the script prints how to create a **fine-grained token** (only this repo; Contents, Pull requests, Issues, Workflows: read and write) and `main.sh` asks you to paste it (hidden input, needs `ssh -t`), then `gh auth login` + `gh auth setup-git`. One token covers clone, push, PRs and issues. Then mise, Node, pnpm, repo clone over https, deps, Playwright browser, herdr installed not started, and the agent CLIs you pick installed not signed in (`setup-tools.sh`): `main.sh` asks per CLI — Cursor (`agent`), Antigravity (`agy`), Claude Code, opencode — `[Y/n]`, or set `AGENT_CLIS="cursor antigravity"` to skip the questions (no terminal = all four)
- **E** as `factory`: `.env` from `.env.example` and `.dev.vars` from `.dev.vars.example` for every app (`omino-api`), `*_SECRET` random (`setup-env.sh`). For every app with `docker-compose.yml` Postgres is started, `db:migrate` applied, then stopped, nothing keeps running (start it yourself: `pnpm db:up`). An existing file is never opened or changed (skipped); only names are logged, never values. If Postgres or migrations fail, the other apps are still done, then the step fails with the list of problems.
- **F** as `factory`: systemd user timer `omino-factory.timer` (every `FACTORY_INTERVAL`, default `10min`) running `pnpm factory`: one pass over `todos/` (execute, review until pass, PR). Installed, **not enabled** (`setup-service.sh`)

`main.sh` calls its sibling scripts, so copy the whole `scripts/` dir to the VPS.

```powershell
# Local machine. Go to this skill dir (change path to yours)
cd C:\Users\john\omino\.nitpick\skills\vps-gon-stack
# Copy scripts to the VPS
scp -i "$env:USERPROFILE\.ssh\id_ed25519_new" -r .\scripts root@1.1.1.1:/root/vps-setup
# Run all. sed strips Windows CR from the copied scripts first. -t: terminal for the token prompt
ssh -t -i "$env:USERPROFILE\.ssh\id_ed25519_new" root@1.1.1.1 "sed -i 's/\r//g' /root/vps-setup/*.sh && bash /root/vps-setup/main.sh"
```

Optional env before `bash`: `FACTORY_USER`, `REPO_URL` (https form, default `https://github.com/xyashino/omino.git`), `GIT_NAME`, `GIT_EMAIL`, `PLAYWRIGHT_VERSION` (keep equal to catalog `@playwright/test`), `SKIP_DB=1` (phase E creates env files only, does not start Postgres), `FACTORY_INTERVAL` (phase F).

On VPS directly (scripts already there): `bash main.sh`

## 3. After

1. Test login in a NEW terminal: `ssh -i "$env:USERPROFILE\.ssh\id_ed25519_new" factory@1.1.1.1`
2. Sign in yourself as `factory` to the runners named in `packages/factory/src/config/models.json`, never via script/chat: Cursor CLI (`NO_OPEN_BROWSER=1 agent login`, open the printed URL locally), Antigravity CLI (`agy`, prints a sign-in URL over ssh), Claude Code (`claude`; `setup-tools.sh` sets `enableAllProjectMcpServers` in `~/.claude/settings.json` so the `.mcp.json` dialog never stalls a worktree), opencode (`opencode auth login`).
3. Start the factory as `factory`: `cd ~/workspaces/omino && pnpm factory --dry-run` (queue preview), then `systemctl --user enable --now omino-factory.timer`. Logs: `journalctl --user -u omino-factory -f`. Stop: `systemctl --user disable --now omino-factory.timer`.
4. Remove the copy on VPS: `rm -rf /root/vps-setup`

Token expired or revoked: as `factory` run `gh auth login --hostname github.com --git-protocol https --with-token` and paste a new one.

## More context

- [references/manual-steps.md](references/manual-steps.md): each phase step by step with manual commands (comments on every command), per-phase scripts, run one phase alone, debug.
