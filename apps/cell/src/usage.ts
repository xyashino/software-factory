export const usage = `usage: factory-cell [--help]

A Cell runs Jobs for the Factory. It is a client of the running factory-server over
$FACTORY_DATA_DIR/factory.sock: it says hello, claims one Job at a time, keeps its lease with
one heartbeat loop, stops its job when it cannot reach the Factory for 45 s, and runs
Inspections, Operator stations and Deliveries. Run more Cells (one instance directory each)
for more parallel Work orders.

config:  ~/.config/factory-cell/config.toml (or $XDG_CONFIG_HOME/factory-cell/config.toml)
           projects = ["my-project"]   projects this Cell may run
           runners = ["claude"]        runners it can start
           capabilities = []           declared capabilities
           factory_data_dir = "..."    where factory.sock is (default $FACTORY_DATA_DIR)
           cell_data_dir = "..."       mirrors, worktrees, identity (default ~/.local/share/factory-cell)
           worktree_limit = 8          worktrees kept per repo before eviction

Stop immediately with SIGINT, or gracefully leave with SIGTERM (asks live stations to hand over).`;
