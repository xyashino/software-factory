#!/usr/bin/env bash
# Debian 13 factory: GitHub access with gh + a fine-grained token. Run as factory. Re-run safe.
# - one token for clone, push, PRs and blocked-task issues (git uses gh as credential helper)
# - no token yet: prints how to create one and exits 10 (main.sh then asks for it)
# Env: REPO_URL (https form, default https://github.com/xyashino/omino.git)
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/xyashino/omino.git}"
NEEDS_TOKEN=10

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

repo_slug() {
  local slug="${REPO_URL#https://github.com/}"
  echo "${slug%.git}"
}

can_push() {
  [ "$(gh api "repos/$(repo_slug)" --jq .permissions.push 2>/dev/null)" = "true" ]
}

check_token() {
  log "GitHub token"
  if gh auth status --hostname github.com >/dev/null 2>&1 && can_push; then
    echo "[OK] gh signed in with push access to $(repo_slug)"
    return 0
  fi
  cat <<EOF
No token with push access to $(repo_slug). Create a fine-grained token:
  https://github.com/settings/personal-access-tokens/new
  Repository access: Only select repositories -> $(repo_slug)
  Permissions (Read and write): Contents, Pull requests, Issues, Workflows
Then as $(id -un): gh auth login --hostname github.com --git-protocol https --with-token
EOF
  exit "$NEEDS_TOKEN"
}

configure_git() {
  log "git credentials via gh"
  gh auth setup-git --hostname github.com
  git ls-remote "$REPO_URL" HEAD >/dev/null || die "git cannot read $REPO_URL"
  echo "[OK] $REPO_URL"
}

main() {
  [ "$(id -u)" -ne 0 ] || die "Run as factory, not root"
  [[ $REPO_URL == https://github.com/* ]] || die "REPO_URL must be https form: https://github.com/<owner>/<repo>.git"
  command -v gh >/dev/null 2>&1 || die "gh missing. Run phase B first."
  check_token
  configure_git
}

main "$@"
