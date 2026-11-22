---
scope: factory
summary: Start refuses foreign listener, stop warns about it
why: a leaked server on 7070 made start report success and stop report not running
date: 2026-11-21
tags: [server, start, stop, cli]
---

- `sf server start` probes the URL before spawn; any answer refuses with `something already answers on <url>, not started by sf`, removes the pid file, spawns nothing.
- Start after spawn: child must stay alive while probe answers; a dead child fails with `exited on start` plus the `server.log` tail (last 20 lines).
- Start timeout (no answer in 10 s) keeps its message and now also appends the log tail; the child is still terminated and the pid file removed.
- `sf server stop` with no live pid and a probe answer returns `not-running` with a warning naming the url; CLI prints `warning: ...` to stderr, exit 0.
- Normal start and stop paths unchanged: same messages, same exit codes, same pid file behaviour.
- Probe unchanged: `GET <url>` with no auth, any HTTP status counts; no port-owner lookup (no pid in the message).
- Tests: fake-ports gains `listening`, `pidFile`, `serverLog`; new unit suite `server-start-stop`; black-box start/stop cases use a real foreign listener.
