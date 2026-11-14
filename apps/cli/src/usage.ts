export const usage = `usage: factory <command> [options]

The Supervisor command line. Talks to a running factory-server over $FACTORY_DATA_DIR/factory.sock;
with no server running, a write or a read runs one command under the writer lock and exits.

  factory run                          start factory-server in the foreground
  factory status [--watch] [--all]     the board
  factory show <order>                 a Work order: state, Cycles, question, Andon
  factory log <order> [-f]             the Traveler, optionally followed
  factory answer <order> "<text>"      answer the open question
  factory resume <order> [--note] [--from <station>] [--grant <n>]
  factory reopen <order> --from <station> [--note]
  factory nudge <order> "<text>"       type into a live Operator's pane
  factory cancel <order> [--reason]
  factory prio <order> high|medium|low
  factory sync                         run intake now (v2-10)
  factory cells [rm <id>]              list or revoke Cells
  factory cells token create [--ttl <d>] [--name <n>] | ls | rm <id>
  factory check                        validate definitions offline
  factory admin export <file>          write the Factory export (STORAGE §7)

Global: --data-dir <path>, --json, --no-color. Settings come from flags, then FACTORY_DATA_DIR,
then the config file (FACTORY_CONFIG or ~/.config/factory/config.json), then the defaults.
`;
