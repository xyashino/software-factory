# VPS Debian 13 - manual + step by step

Reference for [SKILL.md](../SKILL.md). Basic path is `main.sh`. Use this file to run one phase alone, debug, or do it by hand. Phase scripts live in [../scripts](../scripts).

## Phase A - ssh key + password off

Goal: key-only root login. Do in order. Never skip fingerprint check.

1. Check/make ssh key on local machine (not VPS). Set passphrase.
2. Paste pub key into VPS provider panel.
3. First login with key. Confirm fingerprint "yes" only if IP/domain valid. Else STOP.
4. Turn password auth off. Verify password login now fails.

Fast path: [scripts/setup-vps.ps1](../scripts/setup-vps.ps1) (local) runs [scripts/harden-ssh.sh](../scripts/harden-ssh.sh) (VPS).

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup-vps.ps1 -Ip 1.1.1.1 -Email somemail@gmail.com
# Last step prints "Permission denied (publickey)" = success
# Test key login in new terminal before closing old one
```

Bash only (already on VPS): `bash harden-ssh.sh`

## Manual commands

1. Keys (local):

```powershell
# ---------Maintenance--------
# Read public keys
Get-ChildItem $env:USERPROFILE\.ssh -Filter *.pub | ForEach-Object { ssh-keygen -lf $_.FullName }
# Remove legacy pair + known_hosts entry
Remove-Item "$env:USERPROFILE\.ssh\id_ed25519_new", "$env:USERPROFILE\.ssh\id_ed25519_new.pub" -ErrorAction SilentlyContinue
ssh-keygen -R 12.23.123.23
# List known hosts
Get-Content $env:USERPROFILE\.ssh\known_hosts

# --------Creation--------
# New Hostinger friendly key (SET PASSPHRASE)
ssh-keygen -t ed25519 -C "somemail@gmail.com" -f "$env:USERPROFILE\.ssh\id_ed25519_new"
# Pub key to clipboard
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_new.pub" | Set-Clipboard
```

2. Paste pub key to VPS provider.

3. First login (check fingerprint, IP valid, else DON'T):

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_new" root@1.1.1.1
```

```bash
# Prints .bashrc, .profile, .ssh = you're root
ls -all
```

4. Password auth off (VPS):

```bash
# Pass auth possible? (yes if asked for password)
ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@1.1.1.1
# Turn off
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
# No such file = fine
sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config.d/*.conf
# No output = config valid
sshd -t
systemctl restart ssh
# Expect: passwordauthentication no, kbdinteractiveauthentication no
sshd -T | grep -Ei 'passwordauthentication|kbdinteractiveauthentication'
# Retry: must fail (Permission denied publickey)
ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@1.1.1.1
```

## Phase B - root setup

Goal: system packages, Docker, GitHub CLI, firewall on root. Needs phase A done (key login). No `factory` user here (next part). Re-run safe.

1. Packages (build tools, git, libvips, rootless Docker deps, ripgrep).
2. Docker Engine from official repo.
3. GitHub CLI from official repo.
4. Playwright system libs via Playwright's own `install-deps` (temporary apt Node, removed after). Version in `PLAYWRIGHT_VERSION` at top of the script (for the Playwright MCP).
5. ufw (ssh port only) + fail2ban + unattended-upgrades. Aborts if no key in `authorized_keys`.
6. Verify: `docker run hello-world`, tools present.

Fast path: [scripts/setup-root.sh](../scripts/setup-root.sh) pushed from local over ssh.

```powershell
# Local machine, after phase A
# Go to this skill dir (change path to yours), paths below are relative
cd C:\Users\john\software-factory\.nitpick\skills\vps-gon-stack
# tr strips CR on the VPS (PowerShell adds CRLF when piping)
Get-Content .\scripts\setup-root.sh -Raw |
  ssh -i "$env:USERPROFILE\.ssh\id_ed25519_new" root@1.1.1.1 "tr -d '\r' | bash -s"
```

On VPS directly: `bash setup-root.sh`

### Manual commands

1. Packages (VPS, root):

```bash
# Refresh package index
apt-get update
# -y = no prompt. Groups:
#   base: certs, download tools, git (+lfs), json, archives, ssh client, openssl
#   build: compilers/make for native npm modules
#   python3 + pip + venv: node-gyp and tooling
#   libvips-dev: fallback for sharp when prebuilt binary missing
#   uidmap..iptables: rootless Docker deps (user namespaces, networking, storage)
#   ripgrep, fd-find: fast search tools
#   ufw, fail2ban, unattended-upgrades: security (used in step 4)
apt-get install -y \
  ca-certificates curl wget git git-lfs gnupg jq unzip zip tar xz-utils lsb-release \
  openssh-client openssl make gcc g++ build-essential pkg-config \
  python3 python3-pip python3-venv libvips-dev \
  uidmap dbus-user-session slirp4netns fuse-overlayfs iptables \
  ripgrep fd-find ufw fail2ban unattended-upgrades
```

2. Docker Engine:

```bash
# Load distro vars (VERSION_CODENAME = trixie on Debian 13)
. /etc/os-release
# Create keyring dir (mode 755) if missing
install -m 0755 -d /etc/apt/keyrings
# Download Docker's signing key (verifies packages)
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
# Make key readable for apt
chmod a+r /etc/apt/keyrings/docker.asc
# Register official Docker apt repo, pinned to the key above
cat >/etc/apt/sources.list.d/docker.sources <<DOCKER
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
DOCKER
# Read the new repo
apt-get update
# Engine, CLI, container runtime, buildx, compose, rootless extras (for factory later)
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras
# Run test container, then remove it. Prints "Hello from Docker!" = works
docker run --rm hello-world
```

3. GitHub CLI:

```bash
# Keyring dir (same as in Docker step)
install -m 0755 -d /etc/apt/keyrings
# Download GitHub's signing key
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
# Make key readable for apt
chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
# Register official GitHub CLI apt repo for this CPU arch, pinned to the key
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
# Read the new repo
apt-get update
# Install gh
apt-get install -y gh
# Prints version = installed
gh --version
```

4. Playwright system libs (no hand-written list, Playwright decides):

```bash
# Temporary Node + npm from Debian (only to run install-deps)
apt-get install -y nodejs npm
# Install Chromium system libs for this Playwright version
npx --yes playwright@1.64.0 install-deps chromium
# Remove temporary Node. Libs stay (they are installed as manual packages)
apt-get purge -y nodejs npm
apt-get autoremove -y
# Prints nothing/"gone" = removed
command -v node || echo gone
```

5. Firewall + protection (ONLY after key login works, else lockout):

```bash
# Print real ssh port from effective sshd config (usually 22). Use it in next command
sshd -T | awk '$1 == "port" { print $2 }'
# Allow incoming ssh BEFORE enabling firewall (else instant lockout). All else stays blocked
ufw allow 22/tcp
# Turn firewall on now and at every boot. --force skips the "may disrupt ssh" prompt
ufw --force enable
# Check: "Status: active" and 22/tcp ALLOW
ufw status
# Start fail2ban now + at boot: bans IPs that keep failing ssh login
systemctl enable --now fail2ban
# Start auto security updates now + at boot
systemctl enable --now unattended-upgrades
```

## Phase C - factory user

Goal: non-root `factory` account (key login only, no sudo, no password) with its own rootless Docker. Needs phase A (root key) and phase B (Docker, `uidmap`). Tooling (mise, Node, pnpm, bun, repo, agents) is next part. Re-run safe.

1. Create user, dirs (`workspaces`, `logs`, `config`), copy root's `authorized_keys`.
2. Shell env `~/.factory-env` (PATH, `DOCKER_HOST` to rootless socket), sourced from `.bashrc` and `.profile`.
3. Rootless Docker: subuid/subgid, system daemon off, linger on, user daemon installed.
4. Verify: `docker run hello-world` as factory.

Note: system (root) Docker is disabled after this. From now Docker belongs to `factory`.

Fast path: [scripts/setup-factory.sh](../scripts/setup-factory.sh) pushed from local over ssh.

```powershell
# Local machine, after phase B
# Go to this skill dir (change path to yours), paths below are relative
cd C:\Users\john\software-factory\.nitpick\skills\vps-gon-stack
# tr strips CR on the VPS (PowerShell adds CRLF when piping)
Get-Content .\scripts\setup-factory.sh -Raw |
  ssh -i "$env:USERPROFILE\.ssh\id_ed25519_new" root@1.1.1.1 "tr -d '\r' | bash -s"
# Then log in as factory (new terminal)
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_new" factory@1.1.1.1
```

On VPS directly: `bash setup-factory.sh` (custom name: `FACTORY_USER=bot bash setup-factory.sh`)

### Manual commands

1. User (VPS, root):

```bash
# Account with home + own group. No password set = password login impossible
useradd --create-home --shell /bin/bash --user-group factory
# Ssh dir: only factory may enter (700)
install -d -m 0700 -o factory -g factory /home/factory/.ssh
# Work dirs
install -d -m 0750 -o factory -g factory /home/factory/workspaces /home/factory/logs /home/factory/config
# Same admin key can log in as factory
install -m 0600 -o factory -g factory /root/.ssh/authorized_keys /home/factory/.ssh/authorized_keys
```

2. Rootless Docker (VPS, root):

```bash
# Range of uids/gids factory's containers may use
usermod --add-subuids 100000-165535 factory
usermod --add-subgids 100000-165535 factory
# Stop + disable rootful daemon (rootless replaces it)
systemctl disable --now docker.service docker.socket
# Keep factory's user systemd running without login (daemon survives logout)
loginctl enable-linger factory
# Wait until /run/user/<uid>/bus exists, then install daemon as factory
runuser -u factory -- env HOME=/home/factory XDG_RUNTIME_DIR=/run/user/$(id -u factory) \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u factory)/bus \
  dockerd-rootless-setuptool.sh install
```

3. Docker env for factory (put in `/home/factory/.bashrc`, as factory):

```bash
# Where user runtime dir lives
export XDG_RUNTIME_DIR=/run/user/$(id -u)
# Point docker CLI to the rootless socket
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock
```

4. Verify (log in as factory):

```bash
# Prints "Hello from Docker!" = rootless Docker works
docker run --rm hello-world
# Shows "rootless" in security options
docker info | grep -i rootless
```

## Phase D - GitHub access + factory tooling

### GitHub access (gh + fine-grained token)

Goal: `factory` can clone, push branches, open PRs and issues for blocked tasks, with one token bound to this repo only. Runs **as factory**. Needs phase B (`gh`) and C. Re-run safe (working token = nothing asked).

1. Create the token yourself: https://github.com/settings/personal-access-tokens/new. Repository access: **Only select repositories** > the repo the factory serves (this one: `software-factory`). Permissions, all **Read and write**: Contents (push), Pull requests (PRs), Issues (blocked tasks), Workflows (changes in `.github/workflows`). Pick an expiry and note it.
2. `gh auth login --with-token` stores it for `factory` (`~/.config/gh/hosts.yml`, owner-only).
3. `gh auth setup-git`: git uses gh as credential helper for `https://github.com`, so plain `git clone/push` works.
4. Check: the token can push (`gh api repos/<repo> --jq .permissions.push` = `true`) and `git ls-remote` works.

Fast path: [scripts/setup-git.sh](../scripts/setup-git.sh) checks steps 3-4. Without a token it prints step 1 and exits 10; `main.sh` then asks for the token (hidden input, run it with `ssh -t`) and pipes it to `gh auth login` as factory. Token is never printed or saved by the scripts.

Manual commands (as factory):

```bash
# Paste the token, then Enter and Ctrl-D (not shown in shell history)
gh auth login --hostname github.com --git-protocol https --with-token
# git clone/push over https use the gh token
gh auth setup-git --hostname github.com
# "true" = token can push (OWNER/REPO of your repo, this one: xyashino/software-factory)
gh api repos/OWNER/REPO --jq .permissions.push
# Works when it prints a commit hash
git ls-remote https://github.com/OWNER/REPO.git HEAD
```

### Factory tooling

Goal: working dev environment for `factory`: git, Node, pnpm, bun, repo, dependencies. Runs **as factory** (no root, no sudo). Needs phase B (system libs), phase C (user, `~/.factory-env`) and GitHub access above. Re-run safe (pulls repo, skips installed tools). No secrets here.

1. Git defaults (name, email, `pull.ff only`, `init.defaultBranch main`).
2. Clone the repo (`REPO_URL`, default this repo) to `~/workspaces/<repo name>` (`REPO_DIR`) over https (gh token). Re-run = `git pull --ff-only`.
3. mise: install standalone CLI, trust repo config, install Node + pnpm from `.mise.toml`.
4. bun (`~/.bun/bin`, PATH added to `~/.factory-env`): `pnpm sf` and `pnpm factory` run on it. Then `pnpm install --frozen-lockfile`.
5. Install herdr (`~/.local/bin`). Installed only, never started by the script.
6. Install the agent CLIs you picked (`main.sh` asks per CLI, or `AGENT_CLIS` preset): Claude Code (`~/.local/bin`), opencode (`~/.opencode/bin`, PATH added to `~/.factory-env`), Cursor CLI `agent` and Antigravity CLI `agy` (both `~/.local/bin`). Installed only, no sign-in.
7. Verify: tools respond (herdr checked with `command -v`, agent CLIs with `--version`), node, pnpm and bun versions.

Fast path: [scripts/setup-tools.sh](../scripts/setup-tools.sh) pushed from local over ssh **as factory**.

```powershell
# Local machine, after phase C
# Go to this skill dir (change path to yours), paths below are relative
cd C:\Users\john\software-factory\.nitpick\skills\vps-gon-stack
# tr strips CR on the VPS (PowerShell adds CRLF when piping)
Get-Content .\scripts\setup-tools.sh -Raw |
  ssh -i "$env:USERPROFILE\.ssh\id_ed25519_new" factory@1.1.1.1 "tr -d '\r' | bash -s"
```

Custom values: `REPO_URL`, `REPO_DIR`, `GIT_NAME`, `GIT_EMAIL` env vars (set them in the remote command before `bash -s`).

### Manual commands

Log in first: `ssh -i "$env:USERPROFILE\.ssh\id_ed25519_new" factory@1.1.1.1`

1. Git:

```bash
# Commit identity (change to yours)
git config --global user.name "Software Factory"
git config --global user.email "factory@vps"
# New repos start on main
git config --global init.defaultBranch main
# Pull never creates merge commits by accident
git config --global pull.ff only
# Enable git-lfs hooks
git lfs install
```

2. Repo:

```bash
# REPO_URL: https URL of the repo the factory serves (this repo: https://github.com/xyashino/software-factory.git)
REPO_URL=https://github.com/xyashino/software-factory.git
REPO_DIR=~/workspaces/$(basename "${REPO_URL%.git}")
mkdir -p "$(dirname "$REPO_DIR")"
git clone "$REPO_URL" "$REPO_DIR"
cd "$REPO_DIR"
```

3. mise (Node + pnpm pinned via .mise.toml):

```bash
# Install mise CLI into ~/.local/bin
curl -fsSL https://mise.run | sh
# Wire mise shims for login/non-login shells
grep -qF 'mise/shims' ~/.factory-env || echo 'export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"' >> ~/.factory-env
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
# Trust repo config and install tools pinned in .mise.toml (Node + pnpm)
mise trust
mise install
node --version
pnpm --version
```

4. bun (runs `pnpm sf` and `pnpm factory`) + dependencies:

```bash
# Official installer, puts binary in ~/.bun/bin
curl -fsSL https://bun.sh/install | bash
grep -qF '.bun/bin' ~/.factory-env || echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.factory-env
export PATH="$HOME/.bun/bin:$PATH"
bun --version
# Exact lockfile install, fails if lockfile is out of date
pnpm install --frozen-lockfile
```

5. herdr (install only, do NOT run it):

```bash
# Official installer, puts binary in ~/.local/bin (already on PATH via ~/.factory-env)
curl -fsSL https://herdr.dev/install.sh | sh
# Check it is installed, without starting it
command -v herdr
```

6. Agent CLIs (install only, NO sign-in) — run only the ones you picked when the script asked (`AGENT_CLIS`):

```bash
# Claude Code: native installer, binary in ~/.local/bin (no Node needed)
curl -fsSL https://claude.ai/install.sh | bash
# opencode: installer puts binary in ~/.opencode/bin, so add it to PATH for new shells
echo 'export PATH="$HOME/.opencode/bin:$PATH"' >> ~/.factory-env
export PATH="$HOME/.opencode/bin:$PATH"
curl -fsSL https://opencode.ai/install | bash
# Cursor CLI: binary `agent` in ~/.local/bin
curl -fsS https://cursor.com/install | bash
# Antigravity CLI: binary `agy` in ~/.local/bin
curl -fsSL https://antigravity.google/cli/install.sh | bash
# Versions only, no login. Sign in later by hand:
#   claude / opencode auth login / NO_OPEN_BROWSER=1 agent login / agy (prints a sign-in URL over ssh)
agent --version
agy --version
claude --version
opencode --version
```

7. Verify:

```bash
# Quick unit tests for one package = environment works
pnpm --filter @repo/nitpick test
```

## Phase E - env files

Goal: every place that ships a `.env.example` gets its local `.env`. No real secrets. The factory keeps its state in SQLite (the `factory-server` data dir), so there is no database to start or migrate. The repo ships no `.env.example` today: then the step does nothing. Runs **as factory**. Needs phase D. Re-run safe: an existing file is only checked for existence, never opened (delete it to regenerate). Names are logged, values never.

For the repo root and each app in `apps/*` that has a `.env.example`: copy it to `.env`. Template values stay as they are, except `*_SECRET`: random 64 hex chars. File mode 0600.

Fast path: [scripts/setup-env.sh](../scripts/setup-env.sh) (as factory). `main.sh` runs it as step E.

### Manual commands

Log in as factory first.

```bash
cd ~/workspaces/software-factory
# Owner-only copy of the template (-n: never overwrite)
cp -n .env.example .env && chmod 600 .env
# Random secret instead of a template placeholder (repeat per *_SECRET name)
sed -i "s/^AUTH_SECRET=.*/AUTH_SECRET=\"$(openssl rand -hex 32)\"/" .env
# Names only, no values: is every variable filled?
awk -F= '/^[A-Z]/ { printf "%s filled=%d\n", $1, length($2) > 0 }' .env
```

## Phase F - factory-server + factory-cell units

Goal: `factory` runs the v2 Software Factory on its own. Runs **as root**. Needs phase D (repo, token, agent CLIs) and C (user). Re-run safe (units rewritten, enabled state kept).

1. Copy `deploy/systemd/factory-server.service` and `deploy/systemd/factory-cell.service` from the checkout to `/etc/systemd/system/` (both `Type=simple`, `User=factory`, `Restart=on-failure`). Create empty `/etc/factory/factory-server.env` and `/etc/factory/factory-cell.env` (0600) for the optional `EnvironmentFile=-`.
2. A drop-in `checkout.conf` per unit: `ExecStart` runs `pnpm factory-server` / `pnpm factory-cell --repo-dir <repo>` through a login shell in the factory user's checkout (so mise, bun and pnpm are on PATH), `WorkingDirectory` is that checkout, `ProtectHome=no` (the shipped units hide `/home` and expect the repo in `/var/lib/factory/repo`). The Cell drop-in also relaxes `ProtectSystem` to `full` and lets it write the checkout and the factory home (agent CLI state).
3. Installed, **not enabled**: sign in to the agent CLIs first, put `GH_TOKEN` (PR poll) in `/etc/factory/factory-server.env`, for a remote Cell set `FACTORY_JOIN_TOKEN` in `/etc/factory/factory-cell.env`.

The server is the single writer of the Factory data dir (`%S/factory`, SQLite). The Cell polls it for Jobs and runs one Work order in its checkout (`<repo>/.factory-local/cell`). Todos with `factory: v2` become Work orders through intake. Restore after a lost machine: `deploy/RESTORE.md`.

v1 (`pnpm sf`, no units): as factory in the repo, `pnpm sf:run` runs one pass over `todos/` without `factory: v2`. `pnpm sf:status` shows tasks, `pnpm sf:reset` clears them.

Fast path: [scripts/setup-service.sh](../scripts/setup-service.sh) (as root). `main.sh` runs it as step F.

### Manual commands

```bash
# As root. Install the shipped units
install -m 0644 /home/factory/workspaces/software-factory/deploy/systemd/factory-server.service /etc/systemd/system/
install -m 0644 /home/factory/workspaces/software-factory/deploy/systemd/factory-cell.service /etc/systemd/system/
# Optional env files, owner-only
install -d -m 0755 /etc/factory
install -m 0600 /dev/null /etc/factory/factory-server.env
install -m 0600 /dev/null /etc/factory/factory-cell.env
# Run the checkout instead of the packaged binaries (edit the drop-ins: ExecStart, WorkingDirectory, ProtectHome=no)
systemctl edit factory-server
systemctl edit factory-cell
systemctl daemon-reload
# Start
systemctl enable --now factory-server factory-cell
# Follow
journalctl -u factory-server -u factory-cell -f
# Stop
systemctl disable --now factory-cell factory-server
```
