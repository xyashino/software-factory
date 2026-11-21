#!/usr/bin/env bash
# Install the built sf binary and web runtime. Run `pnpm build:sf` first, as your user.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${PREFIX:-/usr/local}"
DESTDIR="${DESTDIR:-}"
BIN_DIR="${DESTDIR}${PREFIX}/bin"
WEB_DIR="${SF_WEB_DIR:-${DESTDIR}${PREFIX}/share/sf/web}"

SF_BIN="$ROOT/apps/sf/dist/sf"
WEB_DIST="$ROOT/apps/web-demo/dist"
WEB_DEPS="$WEB_DIST/sf-deps/node_modules"

require() {
  if [ ! -e "$1" ]; then
    echo "missing $1: run pnpm build:sf first" >&2
    exit 1
  fi
}

require "$SF_BIN"
require "$WEB_DIST/server/entry.mjs"
require "$WEB_DEPS"

install -d "$BIN_DIR" "$WEB_DIR/server" "$WEB_DIR/client" "$WEB_DIR/node_modules"
install -m 0755 "$SF_BIN" "$BIN_DIR/sf"
cp -a "$WEB_DIST/server/." "$WEB_DIR/server/"
cp -a "$WEB_DIST/client/." "$WEB_DIR/client/"
cp -a "$WEB_DEPS/." "$WEB_DIR/node_modules/"

echo "installed $BIN_DIR/sf"
echo "installed $WEB_DIR"
