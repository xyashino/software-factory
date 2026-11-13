#!/usr/bin/env bash
# Debian 13 factory: systemd user timer that runs `pnpm factory` (one pass over todos/). Run as factory. Re-run safe.
# Installed but NOT enabled: sign in to the agent CLIs first, then enable it (printed at the end).
# Env: FACTORY_INTERVAL (systemd time span between passes, default 10min)
set -Eeuo pipefail

FACTORY_INTERVAL="${FACTORY_INTERVAL:-10min}"
UNIT_DIR="$HOME/.config/systemd/user"
REPO_DIR="$HOME/workspaces/omino"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

write_units() {
  log "systemd units"
  mkdir -p "$UNIT_DIR"
  cat >"$UNIT_DIR/omino-factory.service" <<EOF
[Unit]
Description=omino software factory: one pass over todos/
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
# Login shell: ~/.profile sources ~/.factory-env (mise, PATH, Docker, secrets)
ExecStart=/bin/bash -lc 'pnpm factory'
TimeoutStartSec=infinity
EOF
  cat >"$UNIT_DIR/omino-factory.timer" <<EOF
[Unit]
Description=Run the omino software factory every $FACTORY_INTERVAL

[Timer]
OnBootSec=5min
OnUnitInactiveSec=$FACTORY_INTERVAL

[Install]
WantedBy=timers.target
EOF
}

reload() {
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
  systemctl --user daemon-reload
  systemctl --user is-enabled omino-factory.timer >/dev/null 2>&1 &&
    echo "[OK] timer already enabled" ||
    echo "[OK] installed, not enabled"
}

main() {
  [ "$(id -u)" -ne 0 ] || die "Run as factory, not root"
  [ -d "$REPO_DIR/.git" ] || die "No repo in $REPO_DIR. Run phase D first."
  write_units
  reload
  cat <<EOF
After signing in to the agent CLIs (as $(id -un)):
  cd $REPO_DIR && pnpm factory --dry-run          # queue preview, nothing runs
  systemctl --user enable --now omino-factory.timer
  journalctl --user -u omino-factory -f           # logs
  systemctl --user disable --now omino-factory.timer   # stop
EOF
}

main "$@"
