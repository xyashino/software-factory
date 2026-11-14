export const usage = `usage: factory-server [--data-dir <path>] [--once]

Runs the Factory: the single writer of the data directory (default $FACTORY_DATA_DIR, else
~/.local/share/factory). Serves the runtime on <data-dir>/factory.sock (mode 0600). No TCP listener.

--once   Reads one {"route", "request"} JSON object on stdin, runs it under the writer lock, prints
         {"ok", "response" | "error"} on stdout, and exits (0 ok, 1 failed, 2 refused, 3 writer held).
`;
