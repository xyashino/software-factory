---
status: queued
priority: low
line: feature
type: feat
---

# release-binary: prebuilt sf and one-line install

## Objective

Tagged releases publish `sf` binaries and the web UI so a VPS installs without Node, pnpm or Bun.

## Context

`sf` is one compiled binary (`bun build --compile`), but install needs Node, pnpm, Bun and a source build. No release workflow exists; only `pr-ci.yml`. See `docs/onboarding-plan.md`.

## Scope

- **Target**: `.github/workflows/release.yml`, `scripts/`, README install section
- **Classification**: `Infrastructure`
- **Out of scope**: package managers (brew, apt), auto-update.

## Verify first

- Cross-compile targets supported by `bun build --compile --target` (linux x64/arm64, darwin, windows).
- Whether `apps/web-demo/dist/sf-deps/node_modules` has platform-specific native packages.
- Repo visibility: private repo assets need auth to download.

## Open decisions

- Release trigger: tag push vs manual.
- Checksums and signing.

## Implementation Plan

1. **Files**: `release.yml`, `scripts/install-release.sh`.
2. **Behavior**: build per target, attach `sf-<os>-<arch>`, web UI tarball, `SHA256SUMS`. Installer downloads, verifies checksum, installs to `~/.local`.
3. **Integration**: README shows the one-liner next to source install. Pin actions by sha.

## Acceptance Criteria

- [ ] Release for a test tag contains binaries for each target and checksums.
- [ ] Installer on a clean Linux container yields a working `sf --help` and web UI.
- [ ] Checksum mismatch aborts install.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
