import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  rename,
  rm,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WIN = process.platform === 'win32';
const BIN_NAME = WIN ? 'sf.exe' : 'sf';
const SOURCE_BIN_NAMES = WIN ? ['sf.exe', 'sf'] : ['sf'];
const DEFAULT_SOURCE = join(ROOT, 'apps/factory/dist');
const WEB_DIST = join(ROOT, 'apps/factory-web-demo/dist');
const WEB_PARTS = [
  ['server', 'server'],
  ['client', 'client'],
  ['sf-deps/node_modules', 'node_modules'],
];

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

const missing = (path) => new Error(`missing ${path}: run pnpm build:sf first`);

const localAppData = () =>
  process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');

const dataHome = () =>
  process.env.XDG_DATA_HOME ||
  (WIN ? localAppData() : join(homedir(), '.local', 'share'));

const defaultTargets = () => ({
  binDir: WIN
    ? join(dataHome(), 'sf', 'bin')
    : join(homedir(), '.local', 'bin'),
  webDir: join(dataHome(), 'sf', 'web'),
});

const prefixTargets = (prefix) => ({
  binDir: join(prefix, 'bin'),
  webDir: join(prefix, 'share', 'sf', 'web'),
});

const targetsOf = ({ prefix, webDir }) => {
  const base = prefix ?? process.env.PREFIX;
  const targets = base ? prefixTargets(base) : defaultTargets();
  const destdir = process.env.DESTDIR;
  return {
    binDir: destdir ? join(destdir, targets.binDir) : targets.binDir,
    webDir:
      webDir ??
      process.env.SF_WEB_DIR ??
      (destdir ? join(destdir, targets.webDir) : targets.webDir),
  };
};

const findBinary = async (sourceDir) => {
  for (const name of SOURCE_BIN_NAMES) {
    const path = join(sourceDir, name);
    if (await exists(path)) return path;
  }
  throw missing(join(sourceDir, SOURCE_BIN_NAMES[0]));
};

const requireWebBuild = async () => {
  const entry = join(WEB_DIST, 'server', 'entry.mjs');
  for (const path of [entry, join(WEB_DIST, 'sf-deps', 'node_modules')]) {
    if (!(await exists(path))) throw missing(path);
  }
};

const onPath = (dir) => {
  const same = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
  return (process.env.PATH ?? '')
    .split(delimiter)
    .some((entry) => entry !== '' && same(resolve(entry), resolve(dir)));
};

const pathHint = (binDir) =>
  WIN
    ? `add to PATH: $env:Path = "${binDir};" + $env:Path`
    : `add to PATH: export PATH="${binDir}:$PATH"`;

const main = async () => {
  const { values } = parseArgs({
    options: {
      prefix: { type: 'string' },
      source: { type: 'string' },
      'web-dir': { type: 'string' },
    },
  });
  const bin = await findBinary(values.source ?? DEFAULT_SOURCE);
  await requireWebBuild();
  const { binDir, webDir } = targetsOf({
    prefix: values.prefix,
    webDir: values['web-dir'],
  });

  await mkdir(binDir, { recursive: true });
  const binPath = join(binDir, BIN_NAME);
  // Rename over the old file: copying onto a running sf fails with ETXTBSY.
  const staged = `${binPath}.new`;
  await copyFile(bin, staged);
  if (!WIN) await chmod(staged, 0o755);
  await rename(staged, binPath);
  for (const [from, to] of WEB_PARTS) {
    const dest = join(webDir, to);
    await rm(dest, { recursive: true, force: true });
    await cp(join(WEB_DIST, from), dest, {
      recursive: true,
      dereference: true,
    });
  }

  console.log(`installed ${binPath}`);
  console.log(`installed ${webDir}`);
  if (!onPath(binDir)) console.log(pathHint(binDir));
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
