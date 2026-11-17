#!/usr/bin/env bash
# Debian 13 factory: create missing local .env files from .env.example for the repo root and every app.
# Run as factory. Re-run safe. The factory stores its state in SQLite (factory-server data dir), no database to prepare.
# - .env from .env.example, template values are copied as they are, except *_SECRET: random 64 hex chars
# - an existing file is never opened or changed (skipped). Names are logged, values never
# - no .env.example found: nothing to do
# Env: REPO_URL (https form, names the default checkout dir), REPO_DIR (default ~/workspaces/<repo name>)
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/xyashino/software-factory.git}"
REPO_DIR="${REPO_DIR:-$HOME/workspaces/$(basename "${REPO_URL%.git}")}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

create_file() {
  local template="$1" target="$2" rel line name value out=""
  local -a generated=() empty=()
  rel="${target#"$REPO_DIR"/}"

  # Existing file: only checked for existence, never opened
  if [ -e "$target" ]; then
    echo "env: $rel exists, skipped"
    return 0
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
      name="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      if [[ $name == *_SECRET ]]; then
        value="\"$(openssl rand -hex 32)\""
        generated+=("$name")
      elif [ -z "$value" ] || [ "$value" = '""' ]; then
        empty+=("$name")
      fi
      line="$name=$value"
    fi
    out+="$line"$'\n'
  done <"$template"

  # noclobber: never overwrite. umask: owner-only file
  (umask 077 && set -o noclobber && printf '%s' "$out" >"$target")
  echo "env: created $rel (generated: ${generated[*]:-none}; left empty: ${empty[*]:-none})"
}

main() {
  [ "$(id -u)" -ne 0 ] || die "Run as factory, not root"
  [ -f "$HOME/.factory-env" ] || die "No ~/.factory-env. Run phase C first."
  # shellcheck source=/dev/null
  . "$HOME/.factory-env"
  [ -d "$REPO_DIR/.git" ] || die "No repo at $REPO_DIR. Run phase D first."

  local dir done_any=0
  log "Env files in $REPO_DIR"
  for dir in "$REPO_DIR" "$REPO_DIR"/apps/*/; do
    dir="${dir%/}"
    if [ -f "$dir/.env.example" ]; then
      create_file "$dir/.env.example" "$dir/.env"
      done_any=1
    fi
  done
  [ "$done_any" = 1 ] || echo "env: no .env.example found, nothing to do"
}

main "$@"
