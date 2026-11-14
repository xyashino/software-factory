export const usage = `usage: factory-server [--data-dir <path>] [--once | admin <backup|export|import|rebuild-projections> [file]]

Runs the Factory: the single writer of the data directory (default $FACTORY_DATA_DIR, else
~/.local/share/factory). Serves the runtime on <data-dir>/factory.sock (mode 0600). No TCP listener.

--once   Reads one {"route", "request"} JSON object on stdin, runs it under the writer lock, prints
         {"ok", "response" | "error"} on stdout, and exits (0 ok, 1 failed, 2 refused, 3 writer held).

admin    One-shot admin operation on a data directory no server runs on (STORAGE §7).
         backup and export write a new file; import needs an empty database.
`;

export const adminUsage = `usage: factory-server admin <backup|export|import|rebuild-projections> [file]

  backup <file>     consistent copy of factory.db (VACUUM INTO); the file must be new
  export <file>     portable archive (manifest, projects, events, cited blobs); the file must be new
  import <file>     load an export into an empty data directory, then expire active leases
  rebuild-projections
                    rebuild the orders table from the events
`;
