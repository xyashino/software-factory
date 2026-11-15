export const usage = `usage: factory-cell [--help]

A Cell runs Jobs for the Factory. It is a client of the running factory-server over
$FACTORY_DATA_DIR/factory.sock (or over HTTP in remote mode): it registers its repository's project
when the Factory lacks it, says hello, claims one Job at a time, keeps its lease with one heartbeat
loop, stops its job when it cannot reach the Factory for 45 s, and runs Inspections, Operator
stations and Deliveries. Run more Cells (one instance directory each) for more parallel Work orders.

A Cell runs in one repository. The repository is --repo-dir <path> (a directory holding .factory/ or
.git), else the one the working directory is in; a Cell outside a repository is refused. The project
is projects[0] when the config names one, else the repository's directory name. The project is
registered from the repository's origin remote (git remote get-url origin) when missing; an existing
project keeps its settings. A repository with no origin is refused.

config:  ~/.config/factory-cell/config.toml (or $XDG_CONFIG_HOME/factory-cell/config.toml)
         <repo>/.factory/cell.toml overrides it key by key when the Cell runs in that repository
         <repo>/.factory-local/cell.toml (gitignored, machine-local) overrides both key by key
           projects = ["my-project"]   projects this Cell may run (projects[0] names the repository's)
           runners = ["claude"]        runners it can start
           capabilities = []           declared capabilities
           factory_data_dir = "..."    where factory.sock is (default $FACTORY_DATA_DIR)
           cell_data_dir = "..."       mirrors, worktrees, identity (default <repo>/.factory-local/cell)
           worktree_limit = 8          worktrees kept per repo before eviction

Stop immediately with SIGINT, or gracefully leave with SIGTERM (asks live stations to hand over).`;
