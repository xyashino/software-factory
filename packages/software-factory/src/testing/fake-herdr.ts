import type {
  AgentObservation,
  HerdrNotificationOptions,
  HerdrPort,
} from '../ports/herdr.port';

export interface HerdrCall {
  method: keyof HerdrPort;
  args: unknown[];
}

/**
 * Scripted Herdr. `wait` answers from `observations` in order, then `done`.
 * Every call is recorded in `calls`.
 */
export class FakeHerdr implements HerdrPort {
  readonly calls: HerdrCall[] = [];
  observations: AgentObservation[] = [];
  promptResult: 'accepted' | 'blocked' = 'accepted';
  paneText = '';
  /** What `readScreen` answers: the visible screen, menus included. */
  screenText = '';
  /** When set, the next `startAgent` throws it once, as Herdr does for a blocked start. */
  startError: Error | undefined;
  /** Workspace ids Herdr no longer knows; `workspaceExists` answers false for them. */
  readonly missingWorkspaces = new Set<string>();
  readonly notifications: {
    title: string;
    options?: HerdrNotificationOptions;
  }[] = [];
  /** When set, `notify` throws it, to exercise non-fatal handling. */
  notifyError: Error | undefined;
  private readonly known = new Set<string>();

  async notify(title: string, options?: HerdrNotificationOptions) {
    this.record('notify', title, options);
    if (this.notifyError !== undefined) throw this.notifyError;
    this.notifications.push({ title, options });
  }

  async createWorkspace(label: string, cwd: string) {
    this.record('createWorkspace', label, cwd);
    return {
      workspaceId: `ws-${label}`,
      tabId: `tab-${label}-init`,
      paneId: `pane-${label}-init`,
    };
  }

  async workspaceExists(workspaceId: string) {
    this.record('workspaceExists', workspaceId);
    return !this.missingWorkspaces.has(workspaceId);
  }

  async closeWorkspace(workspaceId: string) {
    this.record('closeWorkspace', workspaceId);
    return 'closed' as const;
  }

  async createTab(input: {
    workspaceId: string;
    label: string;
    cwd: string;
    env: Record<string, string>;
  }) {
    this.record('createTab', input);
    return { tabId: `tab-${input.label}`, paneId: `pane-${input.label}` };
  }

  async closeTab(tabId: string) {
    this.record('closeTab', tabId);
    return 'closed' as const;
  }

  async renameTab(tabId: string, label: string) {
    this.record('renameTab', tabId, label);
  }

  async runPane(paneId: string, command: string) {
    this.record('runPane', paneId, command);
  }

  async startAgent(input: {
    name: string;
    kind: string;
    paneId: string;
    args: string[];
    timeoutMs: number;
  }) {
    this.record('startAgent', input);
    if (this.startError !== undefined) {
      const error = this.startError;
      this.startError = undefined;
      throw error;
    }
    this.known.add(input.name);
  }

  async sendKeys(name: string, keys: readonly string[]) {
    this.record('sendKeys', name, keys.join(' '));
  }

  async prompt(name: string, text: string) {
    this.record('prompt', name, text);
    return this.promptResult;
  }

  async wait(name: string, timeoutMs: number): Promise<AgentObservation> {
    this.record('wait', name, timeoutMs);
    return this.observations.shift() ?? 'done';
  }

  async read(name: string, lines: number): Promise<string> {
    this.record('read', name, lines);
    return this.paneText;
  }

  async readScreen(name: string): Promise<string> {
    this.record('readScreen', name);
    return this.screenText;
  }

  async exists(name: string): Promise<boolean> {
    this.record('exists', name);
    return this.known.has(name);
  }

  private record(method: keyof HerdrPort, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
}
