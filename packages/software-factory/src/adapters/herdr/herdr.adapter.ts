import type { AgentObservation, HerdrPort } from '../../ports/herdr.port';

export interface HerdrOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

export type HerdrExec = (args: string[]) => Promise<HerdrOutcome>;

export class HerdrError extends Error {
  readonly args: string[];
  readonly output: string;

  constructor(message: string, args: string[], output: string) {
    super(message);
    this.name = 'HerdrError';
    this.args = args;
    this.output = output;
  }
}

export const execHerdr = async (args: string[]): Promise<HerdrOutcome> => {
  const child = Bun.spawn(['herdr', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
};

export const findJsonString = (
  text: string,
  key: string,
): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return search(parsed, key);
};

const search = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!Array.isArray(value)) {
    const direct: unknown = Object.entries(value).find(
      ([name]) => name === key,
    )?.[1];
    if (typeof direct === 'string') return direct;
  }
  const children: unknown[] = Array.isArray(value)
    ? value
    : Object.values(value);
  for (const child of children) {
    const found = search(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
};

const NOT_FOUND =
  /not[ _-]?found|no such (workspace|tab|agent)|unknown (workspace|tab|agent)|agent_not_found/i;

const toObservation = (status: string | undefined): AgentObservation => {
  switch (status) {
    case 'idle':
    case 'working':
    case 'blocked':
    case 'done':
    case 'unknown':
      return status;
    default:
      return 'unknown';
  }
};

export const createHerdrAdapter = (exec: HerdrExec = execHerdr): HerdrPort => {
  const ok = async (args: string[]): Promise<HerdrOutcome> => {
    const outcome = await exec(args);
    if (outcome.code !== 0) {
      throw new HerdrError(
        `herdr ${args.join(' ')} failed: ${outcome.stderr.trim() || outcome.stdout.trim()}`,
        args,
        `${outcome.stdout}${outcome.stderr}`,
      );
    }
    return outcome;
  };

  return {
    async notify(title, options) {
      const args = ['notification', 'show', title];
      if (options?.body) args.push('--body', options.body);
      if (options?.sound) args.push('--sound', options.sound);
      if (options?.position) args.push('--position', options.position);
      await ok(args);
    },

    async createWorkspace(label, cwd) {
      const args = [
        'workspace',
        'create',
        '--cwd',
        cwd,
        '--label',
        label,
        '--no-focus',
      ];
      const outcome = await ok(args);
      const workspaceId = findJsonString(outcome.stdout, 'workspace_id');
      if (workspaceId === undefined) {
        throw new HerdrError(
          'herdr workspace create returned no workspace_id',
          args,
          outcome.stdout,
        );
      }
      const tabId = findJsonString(outcome.stdout, 'tab_id');
      const paneId = findJsonString(outcome.stdout, 'pane_id');
      return { workspaceId, tabId, paneId };
    },

    async workspaceExists(workspaceId) {
      const args = ['workspace', 'get', workspaceId];
      const outcome = await exec(args);
      if (outcome.code === 0) return true;
      const output = `${outcome.stdout}${outcome.stderr}`;
      if (NOT_FOUND.test(output)) return false;
      throw new HerdrError(
        `herdr workspace get failed for ${workspaceId}: ${outcome.stderr.trim() || outcome.stdout.trim()}`,
        args,
        output,
      );
    },

    async closeWorkspace(workspaceId) {
      const outcome = await exec(['workspace', 'close', workspaceId]);
      if (outcome.code === 0) return 'closed';
      if (NOT_FOUND.test(`${outcome.stdout}${outcome.stderr}`)) return 'absent';
      throw new HerdrError(
        `herdr workspace close failed for ${workspaceId}`,
        ['workspace', 'close', workspaceId],
        outcome.stderr,
      );
    },

    async createTab({ workspaceId, label, cwd, env }) {
      const args = [
        'tab',
        'create',
        '--workspace',
        workspaceId,
        '--cwd',
        cwd,
        '--label',
        label,
        '--no-focus',
      ];
      for (const [key, value] of Object.entries(env)) {
        args.push('--env', `${key}=${value}`);
      }
      const outcome = await ok(args);
      const tabId = findJsonString(outcome.stdout, 'tab_id');
      const paneId = findJsonString(outcome.stdout, 'pane_id');
      if (tabId === undefined || paneId === undefined) {
        throw new HerdrError(
          'herdr tab create returned no tab_id or pane_id',
          args,
          outcome.stdout,
        );
      }
      return { tabId, paneId };
    },

    async closeTab(tabId) {
      const outcome = await exec(['tab', 'close', tabId]);
      if (outcome.code === 0) return 'closed';
      if (NOT_FOUND.test(`${outcome.stdout}${outcome.stderr}`)) return 'absent';
      throw new HerdrError(
        `herdr tab close failed for ${tabId}`,
        ['tab', 'close', tabId],
        outcome.stderr,
      );
    },

    async renameTab(tabId, label) {
      await ok(['tab', 'rename', tabId, label]);
    },

    async runPane(paneId, command) {
      await ok(['pane', 'run', paneId, command]);
    },

    async startAgent({ name, kind, paneId, args, timeoutMs }) {
      await ok([
        'agent',
        'start',
        name,
        '--kind',
        kind,
        '--pane',
        paneId,
        '--timeout',
        String(timeoutMs),
        '--',
        ...args,
      ]);
    },

    async sendKeys(name, keys) {
      await ok(['agent', 'send-keys', name, ...keys]);
    },

    async prompt(name, text) {
      const args = [
        'agent',
        'prompt',
        name,
        text,
        '--wait',
        '--until',
        'working',
        '--until',
        'blocked',
        '--until',
        'idle',
        '--until',
        'done',
        '--timeout',
        '30000',
      ];
      const outcome = await exec(args);
      const out = `${outcome.stdout}${outcome.stderr}`;
      if (out.includes('agent_blocked')) return 'blocked';
      if (outcome.code === 0) return 'accepted';
      if (out.includes('agent_prompt_stalled')) {
        const follow = await exec([
          'agent',
          'wait',
          name,
          '--until',
          'working',
          '--until',
          'blocked',
          '--timeout',
          '60000',
        ]);
        const seen = toObservation(
          findJsonString(follow.stdout, 'agent_status') ??
            findJsonString(follow.stdout, 'status'),
        );
        if (seen === 'working') return 'accepted';
        if (seen === 'blocked') return 'blocked';
      }
      throw new HerdrError(`herdr agent prompt failed for ${name}`, args, out);
    },

    async wait(name, timeoutMs) {
      const args = [
        'agent',
        'wait',
        name,
        '--until',
        'idle',
        '--until',
        'done',
        '--until',
        'blocked',
        '--until',
        'unknown',
        '--timeout',
        String(timeoutMs),
      ];
      const outcome = await exec(args);
      const out = `${outcome.stdout}${outcome.stderr}`;
      if (outcome.code === 0) {
        return toObservation(
          findJsonString(outcome.stdout, 'agent_status') ??
            findJsonString(outcome.stdout, 'status'),
        );
      }
      if (out.includes('"timeout"') || /timed out|timeout/i.test(out))
        return 'timeout';
      if (NOT_FOUND.test(out)) return 'unknown';
      throw new HerdrError(`herdr agent wait failed for ${name}`, args, out);
    },

    async read(name, lines) {
      const args = [
        'agent',
        'read',
        name,
        '--source',
        'recent',
        '--lines',
        String(lines),
      ];
      const outcome = await exec(args);
      if (outcome.code === 0) return outcome.stdout;
      const out = `${outcome.stdout}${outcome.stderr}`;
      if (NOT_FOUND.test(out)) return '';
      throw new HerdrError(
        `herdr ${args.join(' ')} failed: ${outcome.stderr.trim() || outcome.stdout.trim()}`,
        args,
        out,
      );
    },

    async readScreen(name) {
      const args = ['agent', 'read', name, '--source', 'visible'];
      const outcome = await exec(args);
      if (outcome.code === 0) return outcome.stdout;
      const out = `${outcome.stdout}${outcome.stderr}`;
      if (NOT_FOUND.test(out)) return '';
      throw new HerdrError(
        `herdr ${args.join(' ')} failed: ${outcome.stderr.trim() || outcome.stdout.trim()}`,
        args,
        out,
      );
    },

    async exists(name) {
      const args = ['agent', 'get', name];
      const outcome = await exec(args);
      if (outcome.code === 0) return true;
      const output = `${outcome.stdout}${outcome.stderr}`;
      if (NOT_FOUND.test(output)) return false;
      // Any other failure (Herdr unreachable, socket error) says nothing about the
      // agent. Reporting it dead would record a live attempt as crashed.
      throw new HerdrError(
        `herdr agent get failed for ${name}: ${outcome.stderr.trim() || outcome.stdout.trim()}`,
        args,
        output,
      );
    },
  };
};
