#!/usr/bin/env bash
# Debian 13 factory: create missing local env files for every app, then prepare its Postgres.
# Run as factory. Re-run safe.
# - apps/*/.env from .env.example (drizzle-kit), apps/*/.dev.vars from .dev.vars.example (wrangler dev)
# - template values are copied as they are, except *_SECRET: random 64 hex chars
# - an existing file is never opened or changed (skipped). Names are logged, values never
# - app with docker-compose.yml: Postgres is started, migrations applied (db:migrate with
#   DATABASE_URL from .env), then stopped. Nothing keeps running, the data volume stays.
#   A Postgres that already runs is left running
# Env: REPO_DIR (default ~/workspaces/omino), SKIP_DB=1 (env files only, Docker is not touched)
set -Eeuo pipefail

REPO_DIR="${REPO_DIR:-$HOME/workspaces/omino}"
PROBLEMS=()

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
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

has_script() {
  node -e 'process.exit(require(process.argv[1]).scripts?.[process.argv[2]] ? 0 : 1)' "$1/package.json" "$2"
}

prepare_db() {
  local dir="$1" app running
  app="$(basename "$dir")"
  running="$(cd "$dir" && docker compose ps -q --status running)"

  log "Postgres ($app): start, migrate$([ -z "$running" ] && echo ', stop')"
  # Same as `pnpm db:up`, plus --wait for the healthcheck
  if ! (cd "$dir" && docker compose up -d --wait </dev/null); then
    PROBLEMS+=("$app: Postgres did not start (see output above)")
    return 0
  fi
  if has_script "$dir" db:migrate; then
    if [ -f "$dir/.env" ]; then
      (cd "$dir" && set -a && . ./.env && set +a && pnpm db:migrate </dev/null) ||
        PROBLEMS+=("$app: db:migrate failed (see output above)")
    else
      PROBLEMS+=("$app: no .env, migrations skipped")
    fi
  fi
  if [ -z "$running" ]; then
    (cd "$dir" && docker compose down </dev/null) ||
      warn "could not stop Postgres, run: cd apps/$app && pnpm db:down"
  fi
}

main() {
  [ "$(id -u)" -ne 0 ] || die "Run as factory, not root"
  [ -f "$HOME/.factory-env" ] || die "No ~/.factory-env. Run phase C first."
  # shellcheck source=/dev/null
  . "$HOME/.factory-env"
  [ -d "$REPO_DIR/apps" ] || die "No repo at $REPO_DIR. Run phase D first."

  local dir pair done_any=0
  for dir in "$REPO_DIR"/apps/*/; do
    dir="${dir%/}"
    for pair in .env.example:.env .dev.vars.example:.dev.vars; do
      if [ -f "$dir/${pair%%:*}" ]; then
        create_file "$dir/${pair%%:*}" "$dir/${pair##*:}"
        done_any=1
      fi
    done
    if [ -z "${SKIP_DB:-}" ] && [ -f "$dir/docker-compose.yml" ]; then
      prepare_db "$dir"
    fi
  done
  [ "$done_any" = 1 ] || echo "env: no .env.example or .dev.vars.example found, nothing to do"
  # Every app was handled first, then the failures are reported (non-zero exit)
  if [ "${#PROBLEMS[@]}" -gt 0 ]; then
    printf 'ERROR: %s\n' "${PROBLEMS[@]}" >&2
    exit 1
  fi
}

main "$@"
