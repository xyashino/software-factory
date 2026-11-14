export type AgentObservation =
  'idle' | 'working' | 'blocked' | 'done' | 'unknown' | 'timeout';

export interface HerdrNotificationOptions {
  body?: string;
  sound?: 'done' | 'request' | 'none';
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface HerdrPort {
  /** Shows a Herdr toast. Throws when Herdr refuses; callers decide if that matters. */
  notify(title: string, options?: HerdrNotificationOptions): Promise<void>;
  createWorkspace(
    label: string,
    cwd: string,
  ): Promise<{
    workspaceId: string;
    tabId?: string;
    paneId?: string;
  }>;
  /** `false` only when Herdr reports the workspace absent; any other failure throws. */
  workspaceExists(workspaceId: string): Promise<boolean>;
  closeWorkspace(workspaceId: string): Promise<'closed' | 'absent'>;
  createTab(input: {
    workspaceId: string;
    label: string;
    cwd: string;
    env: Record<string, string>;
  }): Promise<{ tabId: string; paneId: string }>;
  closeTab(tabId: string): Promise<'closed' | 'absent'>;
  renameTab(tabId: string, label: string): Promise<void>;
  runPane(paneId: string, command: string): Promise<void>;
  startAgent(input: {
    name: string;
    kind: string;
    paneId: string;
    args: string[];
    timeoutMs: number;
  }): Promise<void>;
  prompt(name: string, text: string): Promise<'accepted' | 'blocked'>;
  /** presses the keys in the agent's pane, in order */
  sendKeys(name: string, keys: readonly string[]): Promise<void>;
  wait(name: string, timeoutMs: number): Promise<AgentObservation>;
  read(name: string, lines: number): Promise<string>;
  /** The text on the agent's visible screen. Works while the agent is blocked on a menu. */
  readScreen(name: string): Promise<string>;
  exists(name: string): Promise<boolean>;
}
