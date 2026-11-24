import { createFactoryCredentialStore } from './adapters/credential-store';
import { createHqLinkClient } from './adapters/hq-link-client';
import { createPidFile } from './adapters/pid-file';
import { createProcessAdapter } from './adapters/process';
import { createRepoConfigAdapter } from './adapters/repo-config';
import { createSystemClock } from './adapters/system-clock';
import { createTodoFilesAdapter } from './adapters/todo-files';
import { FACTORY_CREDENTIAL_PATH, FACTORY_PID_FILE } from './config';
import type { FactoryPorts } from './ports';

export const buildFactoryPorts = (): FactoryPorts => ({
  clock: createSystemClock(),
  process: createProcessAdapter(),
  hqLink: createHqLinkClient(),
  credentials: createFactoryCredentialStore(FACTORY_CREDENTIAL_PATH),
  pidFile: createPidFile(FACTORY_PID_FILE),
  repoConfig: createRepoConfigAdapter(),
  todoFiles: createTodoFilesAdapter(),
});
