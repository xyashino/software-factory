#!/usr/bin/env bash
# Debian 13 factory: install the systemd units factory-server and factory-cell from the repo checkout
# (deploy/systemd/*.service, both Type=simple). Run as root. Re-run safe.
# Installed but NOT enabled: sign in to the agent CLIs first, then enable them (printed at the end).
# A drop-in per unit runs the checkout of the factory user (login shell, so mise, bun and pnpm are on PATH)
# instead of the packaged binaries and the /var/lib/factory/repo path of the shipped units.
# v1 alternative, no units: as factory in the repo, `pnpm sf:run` (todos without `factory: v2`).
# Env: FACTORY_USER (default factory), REPO_URL (names the default checkout dir), REPO_DIR (default ~factory/workspaces/<repo name>)
set -Eeuo pipefail

FACTORY_USER="${FACTORY_USER:-factory}"
REPO_URL="${REPO_URL:-https://github.com/xyashino/software-factory.git}"
UNIT_DIR=/etc/systemd/system
ENV_DIR=/etc/factory

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root"
FACTORY_HOME="$(getent passwd "$FACTORY_USER" | cut -d: -f6)"
[ -n "$FACTORY_HOME" ] || die "No user $FACTORY_USER. Run phase C first."
REPO_DIR="${REPO_DIR:-$FACTORY_HOME/workspaces/$(basename "${REPO_URL%.git}")}"
[ -d "$REPO_DIR/.git" ] || die "No repo in $REPO_DIR. Run phase D first."
for unit in factory-server factory-cell; do
  [ -f "$REPO_DIR/deploy/systemd/$unit.service" ] || die "Missing $REPO_DIR/deploy/systemd/$unit.service"
done

write_units() {
  log "systemd units"
  install -d -m 0755 "$ENV_DIR"
  local unit
  for unit in factory-server factory-cell; do
    install -m 0644 "$REPO_DIR/deploy/systemd/$unit.service" "$UNIT_DIR/$unit.service"
    # Optional env files (EnvironmentFile=-): created empty, 0600, filled by the operator
    [ -e "$ENV_DIR/$unit.env" ] || install -m 0600 /dev/null "$ENV_DIR/$unit.env"
  done

  install -d -m 0755 "$UNIT_DIR/factory-server.service.d" "$UNIT_DIR/factory-cell.service.d"
  cat >"$UNIT_DIR/factory-server.service.d/checkout.conf" <<EOF
[Service]
# Login shell: ~/.profile sources ~/.factory-env (mise, PATH, Docker, secrets)
ExecStart=
ExecStart=/bin/bash -lc 'cd $REPO_DIR && exec pnpm factory-server'
WorkingDirectory=$REPO_DIR
Environment=HOME=$FACTORY_HOME
ProtectHome=no
EOF
  cat >"$UNIT_DIR/factory-cell.service.d/checkout.conf" <<EOF
[Service]
ExecStart=
ExecStart=/bin/bash -lc 'cd $REPO_DIR && exec pnpm factory-cell --repo-dir $REPO_DIR'
WorkingDirectory=$REPO_DIR
Environment=HOME=$FACTORY_HOME
ProtectHome=no
ProtectSystem=full
ReadWritePaths=
ReadWritePaths=$REPO_DIR $FACTORY_HOME
EOF
}

reload() {
  systemctl daemon-reload
  systemctl is-enabled factory-server factory-cell >/dev/null 2>&1 &&
    echo "[OK] units already enabled" ||
    echo "[OK] installed, not enabled"
}

main() {
  write_units
  reload
  cat <<EOF
After signing in to the agent CLIs (as $FACTORY_USER):
  systemctl enable --now factory-server factory-cell
  journalctl -u factory-server -u factory-cell -f      # logs
  systemctl disable --now factory-cell factory-server  # stop
Remote Cell: set FACTORY_JOIN_TOKEN in $ENV_DIR/factory-cell.env (see deploy/systemd/factory-cell.service).
Server env (FACTORY_BIND, FACTORY_REMOTE, GH_TOKEN): $ENV_DIR/factory-server.env
v1 instead (no units): as $FACTORY_USER, cd $REPO_DIR && pnpm sf:run
EOF
}

main "$@"
