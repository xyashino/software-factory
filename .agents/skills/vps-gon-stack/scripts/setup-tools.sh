#!/usr/bin/env bash
# Debian 13 factory tooling: git, mise, Node, pnpm, repo, deps, Playwright browser, agent CLIs.
# Run as factory (NOT root). Needs phase B + C and GitHub access (setup-git.sh). Re-run safe. No secrets here.
# Env: REPO_URL, GIT_NAME, GIT_EMAIL, AGENT_CLIS (space/comma list: cursor antigravity claude opencode;
# unset + terminal = the script asks per CLI, unset + no terminal = install all)
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/xyashino/omino.git}"
GIT_NAME="${GIT_NAME:-Software Factory}"
GIT_EMAIL="${GIT_EMAIL:-factory@$(hostname -s)}"
AGENT_CLIS="${AGENT_CLIS:-}"
REPO_DIR="$HOME/workspaces/omino"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

SELECTED_CLIS=""

# Ask once per CLI. AGENT_CLIS preset wins (main.sh asks and passes it down);
# a terminal gets questions, without one the old behaviour stays: install all.
select_clis() {
  local cli label answer
  if [ -n "$AGENT_CLIS" ]; then
    SELECTED_CLIS=" ${AGENT_CLIS//,/ } "
    log "Agent CLIs (from AGENT_CLIS):$SELECTED_CLIS"
    return
  fi
  if [ -t 0 ]; then
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
        *) SELECTED_CLIS="$SELECTED_CLIS $cli" ;;
      esac
    done
    SELECTED_CLIS=" $SELECTED_CLIS "
    log "Agent CLIs selected:$SELECTED_CLIS"
    return
  fi
  SELECTED_CLIS=" cursor antigravity claude opencode "
  log "No terminal to ask: installing all agent CLIs (set AGENT_CLIS to choose)"
}

want_cli() { case "$SELECTED_CLIS" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

setup_git() {
  log "Git defaults"
  git config --global user.name "$GIT_NAME"
  git config --global user.email "$GIT_EMAIL"
  git config --global init.defaultBranch main
  git config --global pull.ff only
  git lfs install
}

clone_repo() {
  log "Repository"
  mkdir -p "$HOME/workspaces"
  if [ -d "$REPO_DIR/.git" ]; then
    git -C "$REPO_DIR" remote set-url origin "$REPO_URL"
    git -C "$REPO_DIR" pull --ff-only
  else
    git clone "$REPO_URL" "$REPO_DIR"
  fi
}

install_mise() {
  log "mise"
  grep -qF 'mise/shims' "$HOME/.factory-env" ||
    echo 'export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"' >>"$HOME/.factory-env"
  export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"

  if ! command -v mise >/dev/null 2>&1; then
    curl -fsSL https://mise.run | sh
  fi

  mise trust "$REPO_DIR/.mise.toml"
  (cd "$REPO_DIR" && mise install)
}

install_repo_deps() {
  log "Dependencies + Playwright browser"
  cd "$REPO_DIR"
  CI=true pnpm install --frozen-lockfile </dev/null
  # Browser only. System libs were installed in phase B. Playwright lives in vibe-test, not the root
  pnpm --filter @repo/vibe-test exec playwright install chromium </dev/null
}

install_herdr() {
  log "herdr (install only, not started)"
  command -v herdr >/dev/null 2>&1 && return
  curl -fsSL https://herdr.dev/install.sh | sh
}

install_claude_code() {
  log "Claude Code (install only, no sign-in)"
  # Native installer: binary in ~/.local/bin, no Node needed
  command -v claude >/dev/null 2>&1 || curl -fsSL https://claude.ai/install.sh | bash
  # Approve repo .mcp.json servers in user settings: the approval dialog appears in
  # every new worktree and stalls unattended agents; project settings cannot approve.
  local settings="$HOME/.claude/settings.json"
  mkdir -p "$HOME/.claude"
  [ -s "$settings" ] || echo '{}' >"$settings"
  jq '.enableAllProjectMcpServers = true' "$settings" >"$settings.tmp" && mv "$settings.tmp" "$settings"
}

install_opencode() {
  log "opencode (install only, no sign-in)"
  # Installer puts the binary in ~/.opencode/bin. PATH comes from ~/.factory-env (once)
  grep -qF '.opencode/bin' "$HOME/.factory-env" ||
    echo 'export PATH="$HOME/.opencode/bin:$PATH"' >>"$HOME/.factory-env"
  export PATH="$HOME/.opencode/bin:$PATH"
  command -v opencode >/dev/null 2>&1 && return
  curl -fsSL https://opencode.ai/install | bash
}

install_cursor_cli() {
  log "Cursor CLI (install only, no sign-in)"
  command -v agent >/dev/null 2>&1 && return
  # Binary `agent` in ~/.local/bin (already on PATH)
  curl -fsS https://cursor.com/install | bash
}

install_antigravity_cli() {
  log "Antigravity CLI (install only, no sign-in)"
  command -v agy >/dev/null 2>&1 && return
  # Binary `agy` in ~/.local/bin (already on PATH)
  curl -fsSL https://antigravity.google/cli/install.sh | bash
}

verify() {
  log "Verify"
  local cmd
  for cmd in git git-lfs curl jq rg mise node pnpm herdr docker; do
    command -v "$cmd" >/dev/null 2>&1 && echo "[OK] $cmd" || echo "[MISSING] $cmd"
  done
  # Only the selected agent CLIs: versions only, no login needed
  if want_cli cursor; then command -v agent >/dev/null 2>&1 && agent --version || echo "[MISSING] agent (Cursor CLI)"; fi
  if want_cli antigravity; then command -v agy >/dev/null 2>&1 && agy --version || echo "[MISSING] agy"; fi
  if want_cli claude; then command -v claude >/dev/null 2>&1 && claude --version || echo "[MISSING] claude"; fi
  if want_cli opencode; then command -v opencode >/dev/null 2>&1 && opencode --version || echo "[MISSING] opencode"; fi
  node --version
  pnpm --version
  ls "$HOME/.cache/ms-playwright" 2>/dev/null | head -3
}

main() {
  [ "$(id -u)" -ne 0 ] || die "Run as factory, not root"
  [ -f "$HOME/.factory-env" ] || die "No ~/.factory-env. Run phase C first."
  # shellcheck source=/dev/null
  . "$HOME/.factory-env"
  setup_git
  clone_repo
  select_clis
  install_mise
  install_repo_deps
  install_herdr
  if want_cli cursor; then install_cursor_cli; fi
  if want_cli antigravity; then install_antigravity_cli; fi
  if want_cli claude; then install_claude_code; fi
  if want_cli opencode; then install_opencode; fi
  verify
  echo "Tools ready. Repo: $REPO_DIR"
}

main "$@"
