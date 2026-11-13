/**
 * Machine-local values (I2, RULES §2.2): absolute and home-relative paths, Windows drive paths,
 * hostnames, pane ids and process ids. They must never reach a stored event.
 */
const PATHS_HOSTS_PANES: readonly RegExp[] = [
  /(^|[\s"'(=,])(\/[\w.@-]+){2,}/,
  /(^|[\s"'(=,])~\//,
  /\b[A-Za-z]:\\/,
  /\b[a-z0-9-]+\.(local|lan|internal|localdomain)\b/i,
  /\blocalhost\b/i,
  /\bw-?\d+-\d+\b/,
  /\bpane[-_:]\w+/,
  /%\d+\b/,
  /\bpid[=: ]\d+/i,
];

/** Host:port pairs. Only free text is checked for them: an id may start with digits and a hyphen. */
const HOST_PORT: readonly RegExp[] = [
  /\b[a-z][a-z0-9-]*:\d{2,5}\b/i,
  /\b\d{1,3}(\.\d{1,3}){3}:\d+\b/,
];

/** An identifier or enum-like name: no path, host or pane. */
export const isMachineIndependentId = (text: string): boolean =>
  !PATHS_HOSTS_PANES.some((pattern) => pattern.test(text));

/** Free text or a name: no path, host, pane or host:port. */
export const isMachineIndependentText = (text: string): boolean =>
  isMachineIndependentId(text) &&
  !HOST_PORT.some((pattern) => pattern.test(text));
