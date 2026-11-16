export const usage = `usage: factory-server [--data-dir <path>] [--once | admin <backup|export|import|rebuild-projections> [file] | admin token create <name>]

Runs the Factory: the single writer of the data directory (default $FACTORY_DATA_DIR, else
~/.local/share/factory). Serves the runtime over HTTP and SSE (PROTOCOL §2, §3) and writes
<data-dir>/server.json (mode 0600): the address and the local token that local clients read. The file is
removed on a clean shutdown.

FACTORY_BIND      host:port of the listener (default 127.0.0.1:7878; port 0 picks a free port)
GITHUB_WEBHOOK_SECRET  HMAC key of POST /v1/webhooks/github, the pull request state feed (PROTOCOL §3.6)

--once   Reads one {"route", "request"} JSON object on stdin, runs it under the writer lock, prints
         {"ok", "response" | "error"} on stdout, and exits (0 ok, 1 failed, 2 refused, 3 writer held).

admin    One-shot admin operation on a data directory no server runs on (STORAGE §7).
         backup and export write a new file; import needs an empty database.
`;

export const adminUsage = `usage: factory-server admin <backup|export|import|rebuild-projections> [file]
       factory-server admin token create <name>

  token create <name>
                    a supervisor token for remote mode; printed once, only its hash is stored
  backup <file>     consistent copy of factory.db (VACUUM INTO); the file must be new
  export <file>     portable archive (manifest, projects, events, cited blobs); the file must be new
  import <file>     load an export into an empty data directory, then expire active leases
  rebuild-projections
                    rebuild the orders table from the events
`;
