---
scope: factory
summary: Publish sf release binaries and a one-line installer
why: A VPS needed Node, pnpm and Bun plus a source build to run sf; tagged GitHub releases now ship the binary and web UI
date: 2026-11-22
tags: [release, install, ci]
---

- `.github/workflows/release.yml`: `push` on tags `v*` plus `workflow_dispatch`. Matrix `linux-x64`, `linux-arm64`, `darwin-arm64`; each builds web UI, web tarball and `bun build --compile --target=bun-<target>`, uploads artifacts.
- Web tarball per target, `sf-web-<target>.tar.gz`, layout `web/{server,client,node_modules}`: `sf-deps` ships host-arch native `.node` binaries (lightningcss, astro compiler, sharp, rolldown), so one arch-neutral tarball is not safe.
- `publish` job (tags only, `contents: write`): `sha256sum sf-*` into `SHA256SUMS`, `gh release create --verify-tag --generate-notes`. Dispatch stops after artifact upload (dry run).
- Actions pinned by sha; `bun-version` 1.4.4 matches `@types/bun`.
- `scripts/install-release.sh`: POSIX sh for `curl | sh`. Detects `Linux-x86_64|aarch64`, `Darwin-arm64`; other platforms exit 1.
- Downloads from `SF_RELEASE_BASE_URL` (default latest release, `SF_VERSION` pins a tag). Checks both assets against `SHA256SUMS` before any write.
- Installs `$PREFIX/bin/sf` (via `sf.new` then rename, avoids ETXTBSY) and `$PREFIX/share/sf/web` (default `PREFIX=$HOME/.local`).
- `apps/sf/test/blackbox/install-release.test.ts`: install from fixture release, checksum mismatch leaves prefix untouched, unsupported platform exits 1. Platform faked via `uname` on PATH.
- README install section: prebuilt one-liner next to source install.
- Limit: `sf --version` still `0.0.0` in release builds.
- Limit: Windows not built (installer is sh). Darwin x64 not built.
- Limit: install script comes from `main`, not from the tag; checksums cover binaries only.
- Limit: release workflow not run on GitHub (needs push); validated by YAML parse and local cross-compile only.
- Out of scope: `scripts/install.mjs` stale `apps/factory/dist` source path, tracked in `todos/install-fix-source-path.md`.
