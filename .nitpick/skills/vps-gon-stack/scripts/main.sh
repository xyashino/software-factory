#!/usr/bin/env bash
# Debian 13 full setup, run as root AFTER the first ssh key login. Re-run safe.
# Order: A ssh hardening -> B root setup -> C factory user -> D GitHub token + factory tooling -> E env files -> F factory-server + factory-cell units.
# Needs the sibling scripts in the same directory.
# Env (optional): FACTORY_USER, REPO_URL (https form, default https://github.com/xyashino/software-factory.git), REPO_DIR (default ~factory/workspaces/<repo name>), GIT_NAME, GIT_EMAIL, PLAYWRIGHT_VERSION, AGENT_CLIS (agent CLIs to install; unset = the script asks)
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY_USER="${FACTORY_USER:-factory}"
REPO_URL="${REPO_URL:-https://github.com/xyashino/software-factory.git}"
FACTORY_HOME="$(getent passwd "$FACTORY_USER" | cut -d: -f6 || true)"
REPO_DIR="${REPO_DIR:-${FACTORY_HOME:-/home/$FACTORY_USER}/workspaces/$(basename "${REPO_URL%.git}")}"
export FACTORY_USER REPO_URL REPO_DIR

log() { printf '\n########## %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root"
for f in harden-ssh.sh setup-root.sh setup-factory.sh setup-git.sh setup-tools.sh setup-env.sh setup-service.sh; do
  [ -f "$DIR/$f" ] || die "Missing $DIR/$f"
done

# Ask which agent CLIs to install (setup-tools.sh takes AGENT_CLIS as-is).
# Preset env wins; without a terminal every CLI is installed.
choose_agent_clis() {
  local cli label answer selected=""
  if [ -n "${AGENT_CLIS:-}" ]; then
    echo "Agent CLIs (from AGENT_CLIS): $AGENT_CLIS"
    return
  fi
  if [ ! -t 0 ]; then
    AGENT_CLIS="cursor antigravity claude opencode"
    echo "No terminal to ask: installing all agent CLIs (set AGENT_CLIS to choose)"
    return
  fi
  for cli in cursor antigravity claude opencode; do
    case "$cli" in
      cursor) label="Cursor CLI (cursor-agent)" ;;
      antigravity) label="Antigravity CLI (agy)" ;;
      claude) label="Claude Code (claude)" ;;
      opencode) label="opencode" ;;
    esac
    read -rp "Install $label? [Y/n] " answer
    case "$answer" in
      n | N | no | NO) echo "skip $cli" ;;
      *) selected="$selected $cli" ;;
    esac
  done
  AGENT_CLIS="${selected# }"
  echo "Agent CLIs selected: ${AGENT_CLIS:-none}"
}

# Login shell as factory. -w keeps the listed vars. Script comes via stdin (factory cannot read /root)
as_factory() {
  local vars="$1" script="$2"
  runuser -w "$vars" -l "$FACTORY_USER" -c "bash -s" <"$DIR/$script"
}

# setup-git.sh exits 10 when there is no token. runuser -c has no terminal, so root asks and pipes it to gh
github_access() {
  local status=0 token
  as_factory REPO_URL,REPO_DIR setup-git.sh || status=$?
  [ "$status" -eq 10 ] || return "$status"
  [ -t 0 ] || die "No terminal to paste the token. Sign in as $FACTORY_USER (see above), then re-run."
  read -rsp 'Paste the token (hidden): ' token
  echo
  [ -n "$token" ] || die "Empty token"
  printf '%s' "$token" |
    runuser -l "$FACTORY_USER" -c 'gh auth login --hostname github.com --git-protocol https --with-token'
  unset token
  as_factory REPO_URL,REPO_DIR setup-git.sh
}

log "A: SSH hardening (key-only login)"
bash "$DIR/harden-ssh.sh"

log "B: root setup (packages, Docker, gh, Playwright libs, firewall)"
bash "$DIR/setup-root.sh"

log "C: $FACTORY_USER user + rootless Docker"
bash "$DIR/setup-factory.sh"

log "D: GitHub access as $FACTORY_USER (gh + fine-grained token, asks for it once)"
github_access

log "D: choose agent CLIs to install"
choose_agent_clis
export AGENT_CLIS

log "D: tooling as $FACTORY_USER (mise, Node, pnpm, bun, repo, herdr + selected agent CLIs)"
as_factory REPO_URL,REPO_DIR,GIT_NAME,GIT_EMAIL,AGENT_CLIS setup-tools.sh

log "E: .env from .env.example where the repo has one, as $FACTORY_USER"
as_factory REPO_URL,REPO_DIR setup-env.sh

log "F: factory-server + factory-cell systemd units, as root (installed, not enabled)"
bash "$DIR/setup-service.sh"

cat <<DONE

########## ALL DONE
1. Test login in a NEW terminal: ssh -i <key> $FACTORY_USER@<host>
2. As $FACTORY_USER sign in to the agent CLIs you installed: NO_OPEN_BROWSER=1 agent login (Cursor) / agy (Antigravity) / claude / opencode auth login
3. Repo: $REPO_DIR. Put GH_TOKEN (PR poll) in /etc/factory/factory-server.env, then start: systemctl enable --now factory-server factory-cell. Logs: journalctl -u factory-server -u factory-cell -f. v1 instead: as $FACTORY_USER, cd $REPO_DIR && pnpm sf:run
4. .env files created from .env.example where the repo has them (random *_SECRET). The factory keeps its state in SQLite, no database to start
DONE
