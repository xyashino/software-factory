# Restore runbook

Four ways back, from cheapest to last resort (STORAGE §7, §8). Pick the first one that has its
material. Commands are the ones the binaries print in `--help` and in their usage strings; the test
`apps/server/src/__tests__/deploy-assets.test.ts` checks that they still match.

Paths assume the units in `deploy/systemd/`: the data directory is `/var/lib/factory`, the Cell's
state is `/var/lib/factory-cell`.

| You have                             | Use                                     |
| :----------------------------------- | :-------------------------------------- |
| A Litestream replica of `factory.db` | A. Litestream restore                   |
| A snapshot from `backup`             | B. Snapshot restore                     |
| An export archive (`export`)         | C. Export and import into a new Factory |

With none of these there is nothing to restore: the server keeps no git and reads no repository, so
it cannot rebuild its Work orders from a repository (see "No backup at all" below).

Before any step that writes the database, stop the server: it holds the writer lock, and an offline
admin command refuses to run while it does.

```sh
systemctl stop factory-cell factory-server
```

## A. Litestream restore (lost disk, replica exists)

1. Restore the latest state into the empty data directory:

   ```sh
   litestream restore -config /etc/litestream.yml -if-db-not-exists /var/lib/factory/factory.db
   ```

2. Start the Factory and the Cells. Cells keep their credentials, so they rejoin without a token:

   ```sh
   systemctl start factory-server factory-cell
   ```

3. Check the board: `factory status`. Work orders that were running are back as queued after their
   leases expire (CORE §5.2 `ExpireLease`).

Litestream keeps the WAL up to the last `sync-interval`. Work done after that point is lost; the
Cycle runs again on its last committed checkpoint.

## B. Snapshot restore (a `backup` file exists)

1. Put the snapshot in place and remove any stale WAL files next to it:

   ```sh
   cp /root/factory-backup.db /var/lib/factory/factory.db
   rm -f /var/lib/factory/factory.db-wal /var/lib/factory/factory.db-shm
   ```

2. Start the Factory and the Cells:

   ```sh
   systemctl start factory-server factory-cell
   ```

Taking the snapshot: `factory admin backup <file>` while the server runs (through the socket), or
`factory-server admin backup <file>` while it is stopped. The file must be new.

## C. Export and import into a new Factory

Use this to move the queue to another machine (Factory B). Leases, tokens, Cells and the
idempotency table do not travel: the active jobs of the imported Work orders are expired on import,
and the Cells join again.

1. On Factory A, with the server stopped, write the archive:

   ```sh
   factory-server admin export /root/factory.tar
   ```

   With the server running, `factory admin export <file>` does the same through the socket.

2. On Factory B, with an empty data directory (no `factory.db`), import it. The import refuses a
   database that already has data:

   ```sh
   factory-server admin import /root/factory.tar
   ```

   The import appends `ExpireLease` for every Work order that had an active job, so each of them
   is put back in the queue.

3. Create the supervisor token and a join token for the Cells of B. Remote mode needs both:

   ```sh
   factory-server admin token create ops-b          # stopped server; printed once
   systemctl start factory-server                   # FACTORY_REMOTE=1 in /etc/factory/factory-server.env
   factory cells token create --ttl 1d --name cell-b
   ```

4. Each Cell joins again. Put the join token in `/etc/factory/factory-cell.env` as
   `FACTORY_JOIN_TOKEN=...`, and point the Cell's `config.toml` at Factory B with `factory_url`:

   ```sh
   systemctl start factory-cell
   ```

   A Cell that has its old credential for Factory A is refused with `401`. It stops its jobs and
   joins again with the token, as a new Cell (PROTOCOL §1, §9).

## No backup at all

There is no rebuild from git. The server holds tasks and state only, so a lost database with no
snapshot and no export is lost. Start a new Factory and let the Supervisors create the Work orders
again through the task API (`POST /v1/orders`, `POST /v1/plans`), each with its pinned Line. The
repositories' `.factory/` and todos are the source for those requests; the Work orders' history is
not recovered (STORAGE §8).

Take a `backup` or an `export` on a schedule, so this case does not arise.

## Notes

- The units run the server and the Cell as the `factory` user, because a local Cell talks to
  `factory.sock`, which is mode 0600.
- `TimeoutStopSec=330` on the Cell is longer than the leave cap of 5 minutes, so a graceful leave can
  finish (PROTOCOL §9).
- The server calls no `gh`. Pull request state arrives by the GitHub webhook (`POST /v1/webhooks/github`,
  PROTOCOL §3.6): `GITHUB_WEBHOOK_SECRET` goes in `/etc/factory/factory-server.env`, with
  `FACTORY_REMOTE=1` so the HTTP listener serves it.
