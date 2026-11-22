#!/bin/sh
# Install the prebuilt sf binary and web UI from a GitHub release. POSIX sh so `curl | sh` works.
# SHA256SUMS covers the release assets, not this script.
set -eu

RELEASES="https://github.com/xyashino/software-factory/releases"
if [ -n "${SF_VERSION:-}" ]; then
  DEFAULT_BASE="$RELEASES/download/$SF_VERSION"
else
  DEFAULT_BASE="$RELEASES/latest/download"
fi
BASE_URL="${SF_RELEASE_BASE_URL:-$DEFAULT_BASE}"
PREFIX="${PREFIX:-$HOME/.local}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64 | Linux-amd64) target=linux-x64 ;;
  Linux-aarch64 | Linux-arm64) target=linux-arm64 ;;
  Darwin-arm64) target=darwin-arm64 ;;
  *)
    echo "unsupported platform: $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for asset in "sf-$target" "sf-web-$target.tar.gz" SHA256SUMS; do
  curl -fsSL -o "$tmp/$asset" "$BASE_URL/$asset"
done

cd "$tmp"
awk -v bin="sf-$target" -v web="sf-web-$target.tar.gz" '$2 == bin || $2 == web' SHA256SUMS > check.txt
if [ "$(wc -l < check.txt)" -ne 2 ]; then
  echo "SHA256SUMS has no entry for $target" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  verify="sha256sum -c check.txt"
else
  verify="shasum -a 256 -c check.txt"
fi
$verify >/dev/null 2>&1 || {
  echo "checksum mismatch, nothing installed" >&2
  exit 1
}

bin_dir="$PREFIX/bin"
web_dir="$PREFIX/share/sf/web"

mkdir -p "$bin_dir" "$PREFIX/share/sf"
cp "$tmp/sf-$target" "$bin_dir/sf.new"
chmod 0755 "$bin_dir/sf.new"
mv "$bin_dir/sf.new" "$bin_dir/sf"

mkdir "$tmp/web-stage"
tar -xzf "$tmp/sf-web-$target.tar.gz" -C "$tmp/web-stage"
rm -rf "$web_dir"
mv "$tmp/web-stage/web" "$web_dir"

echo "installed $bin_dir/sf"
echo "installed $web_dir"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "add to PATH: export PATH=\"$bin_dir:\$PATH\"" ;;
esac
home="${HOME:-}"
default_data_home="${XDG_DATA_HOME:-$home/.local/share}"
if [ "$web_dir" != "$default_data_home/sf/web" ]; then
  echo "set SF_WEB_DIR=$web_dir when running sf"
fi
