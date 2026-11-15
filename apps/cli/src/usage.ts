export const usage = `usage: factory <command> [options]

The Supervisor command line. Talks to a running factory-server over $FACTORY_DATA_DIR/factory.sock;
with no server running, a write or a read runs one command under the writer lock and exits.

  factory run                               start factory-server in the foreground
  factory status [--watch] [--all]          the board
  factory show <order>                      a Work order: state, Cycles, question, Andon
  factory log <order> [-f]                  the Traveler, optionally followed
  factory answer <order> "<text>"           answer the open question
  factory resume <order> [--note] [--from <station>] [--grant <n>]
  factory reopen <order> --from <station> [--note]
  factory nudge <order> "<text>"            type into a live Operator's pane
  factory cancel <order> [--reason]
  factory prio <order> high|medium|low
  factory sync [--dir <d>] [--project <id>] [--git]
                                            replace the board with ./todos (cancels orders not in it)
  factory cells [rm <id>]                   list or revoke Cells
  factory cells token create [--ttl <d>] [--name <n>] | ls | rm <id>
  factory project ls                        list the projects
  factory project add <id> --repo <url> [--base-branch <b>] [--dep-policy delivered|merged] [--max-running <n>]
  factory project set <id> [--base-branch <b>] [--dep-policy delivered|merged] [--max-running <n>]
  factory project rm <id>                   remove a project with no history
  factory plan ls                           list the Order Plans
  factory plan status <slug> [--project <id>]  the chain of one plan, its plan PR and Andon
  factory check                             validate definitions offline
  factory admin backup <file>               write an online SQLite backup (STORAGE §7)
  factory admin export <file>               write the Factory export (STORAGE §7)
  factory admin rebuild-projections         rebuild projections from the event log (STORAGE §7)
  factory admin recover [--project <id>]    rebuild Work orders from git after a lost database (STORAGE §8)

Global: --data-dir <path>, --json, --no-color. Settings come from flags, then FACTORY_DATA_DIR,
then the config file (FACTORY_CONFIG or ~/.config/factory/config.json), then the defaults.
`;
