---
scope: factory
summary: Install sf on Linux and Windows 10 via pnpm install:sf
why: one command installs sf and the web UI to user dirs, no admin rights, on Linux and Windows 10
date: 2026-11-21
tags: [cli, install, windows]
---

- `pnpm install:sf` runs `build:sf` then `scripts/install.mjs` (pure Node ESM).
- Linux defaults: `~/.local/bin/sf`, web in `$XDG_DATA_HOME/sf/web`. Windows 10: `%LOCALAPPDATA%\sf\bin\sf.exe`, web in `%LOCALAPPDATA%\sf\web`.
- `--prefix`, `--source`, `--web-dir`, env `PREFIX`, `DESTDIR`, `SF_WEB_DIR` override targets. Missing build exits 1 with `run pnpm build:sf first`.
- Binary goes through a staged copy then rename, so reinstall works while `sf` runs (copy onto a running binary gives ETXTBSY).
- Web copy dereferences all links, so the install stays valid after the build tree is rebuilt or cleaned.
  - `pnpm deploy` writes absolute links into the checkout; copying them kept the install pointing there.
  - Dereferencing also covers Windows junctions without symlink privilege.
- Each web target is cleared before copy, so reinstall leaves no stale files.
- Prints a PATH hint (`export PATH` or PowerShell `$env:Path`) when the bin dir is missing from PATH.
- `sf web start` finds the web entry in `DEFAULT_DATA_DIR/web` without `SF_WEB_DIR`. `/usr/...` fallbacks skipped on win32.
- Compiled detection matches `/$bunfs/` and `/~BUN/` (Windows Bun builds).
- `operatorCommandOf` quotes binary or entry paths that contain spaces.
- `where` replaces `which` on win32; spawned processes use `windowsHide: true`.
- `build:sf` deploy uses `--force`; `LOCALAPPDATA` added to turbo `globalEnv`.
- `scripts/install.sh` unchanged; `standalone-external-repo.test.ts` still runs against it.
