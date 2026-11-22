---
scope: factory/service
summary: Add sf service install and uninstall for systemd user units
why: VPS server and Cells died on logout; systemd user units keep them up and restart on failure
date: 2026-11-22
tags: [service, systemd, onboarding]
---

- `sf service install [--cell <name>] [--project <id>]` writes `sf-server.service` and optionally `sf-cell-<name>.service` to `$XDG_CONFIG_HOME/systemd/user`.
- Units run foreground: server via existing `serverArgsOf` (`sf __server`, or bun + entry in dev), Cell via `sf cell start --name <name>` with `WorkingDirectory` = install dir.
- Both units use `Restart=on-failure`, `WantedBy=default.target`.
- `FACTORY_JOIN_TOKEN` read from install-time env, written to `<data dir>/service/sf-cell-<name>.env` mode `0600`, loaded via `EnvironmentFile=`. Never in the unit or output.
- Install refuses to overwrite a unit it did not write (marker line `# managed-by: sf service install`).
- Install never runs `systemctl` or `loginctl`; prints the `enable --now` and `enable-linger` commands.
- `sf service uninstall [--cell <name>]` removes only managed units and their env files.
- Linux only. macOS, Windows and system-wide units out of scope.
- `sf server start` and `sf server stop` do not manage a server run by systemd (no pid file written).
