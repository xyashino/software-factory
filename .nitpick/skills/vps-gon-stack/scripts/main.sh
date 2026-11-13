#!/usr/bin/env bash
# Debian 13 full setup, run as root AFTER the first ssh key login. Re-run safe.
# Order: A ssh hardening -> B root setup -> C factory user -> D GitHub token + factory tooling -> E env files + Postgres -> F factory timer.
# Needs the sibling scripts in the same directory.
# Env (optional): FACTORY_USER, REPO_URL (https form), GIT_NAME, GIT_EMAIL, PLAYWRIGHT_VERSION, SKIP_DB=1, FACTORY_INTERVAL, AGENT_CLIS (agent CLIs to install; unset = the script asks)
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY_USER="${FACTORY_USER:-factory}"
export FACTORY_USER

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
  as_factory REPO_URL setup-git.sh || status=$?
  [ "$status" -eq 10 ] || return "$status"
  [ -t 0 ] || die "No terminal to paste the token. Sign in as $FACTORY_USER (see above), then re-run."
  read -rsp 'Paste the token (hidden): ' token
  echo
  [ -n "$token" ] || die "Empty token"
  printf '%s' "$token" |
    runuser -l "$FACTORY_USER" -c 'gh auth login --hostname github.com --git-protocol https --with-token'
  unset token
  as_factory REPO_URL setup-git.sh
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

log "D: tooling as $FACTORY_USER (mise, Node, pnpm, repo, Playwright browser, herdr + selected agent CLIs)"
as_factory REPO_URL,GIT_NAME,GIT_EMAIL,AGENT_CLIS setup-tools.sh

log "E: .env / .dev.vars for every app + Postgres migrations, as $FACTORY_USER (Postgres is started only to migrate, then stopped. SKIP_DB=1 skips it)"
as_factory SKIP_DB setup-env.sh

log "F: factory timer as $FACTORY_USER (installed, not enabled)"
as_factory FACTORY_INTERVAL setup-service.sh

cat <<DONE

########## ALL DONE
1. Test login in a NEW terminal: ssh -i <key> $FACTORY_USER@<host>
2. As $FACTORY_USER sign in to the runners named in packages/factory/src/config/models.json: NO_OPEN_BROWSER=1 agent login (Cursor) / agy (Antigravity) / claude / opencode auth login
3. Repo: ~/workspaces/omino. Preview the queue: pnpm factory --dry-run. Start: systemctl --user enable --now omino-factory.timer
4. apps/*/.env and apps/*/.dev.vars created from their templates (random *_SECRET). Postgres migrated and stopped: start it with "pnpm db:up"
DONE
