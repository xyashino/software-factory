// Stages the web runtime's production node_modules into apps/web-demo/dist/sf-deps.
// bun has no deploy command, so workspace packages are copied in as source.
import { spawnSync } from 'node:child_process';
import {
  access,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'apps/web-demo');
const TARGET = join(APP, 'dist/sf-deps');
const WORKSPACE_GROUPS = ['apps', 'packages'];

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const findWorkspaces = async () => {
  const dirs = new Map();
  for (const group of WORKSPACE_GROUPS) {
    for (const entry of await readdir(join(ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(ROOT, group, entry.name);
      const manifest = await readJson(join(dir, 'package.json')).catch(() => null);
      if (manifest) dirs.set(manifest.name, dir);
    }
  }
  return dirs;
};

const collect = async ({ catalog, workspaces }) => {
  const external = new Map();
  const local = new Map();
  const visit = async (dir) => {
    const manifest = await readJson(join(dir, 'package.json'));
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (range.startsWith('workspace:')) {
        if (local.has(name)) continue;
        const pkgDir = workspaces.get(name);
        if (!pkgDir) throw new Error(`workspace package not found: ${name}`);
        local.set(name, pkgDir);
        await visit(pkgDir);
        continue;
      }
      const resolved = range === 'catalog:' ? catalog[name] : range;
      if (!resolved) throw new Error(`no catalog entry for ${name}`);
      if (external.has(name) && external.get(name) !== resolved) {
        throw new Error(`conflicting ranges for ${name}: ${external.get(name)} vs ${resolved}`);
      }
      external.set(name, resolved);
    }
  };
  await visit(APP);
  return { external, local };
};

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

const writeManifest = (external) => {
  const dependencies = Object.fromEntries([...external].sort(([a], [b]) => a.localeCompare(b)));
  const manifest = { name: 'sf-deps', private: true, type: 'module', dependencies };
  return writeFile(join(TARGET, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};

const copyLocal = async (local) => {
  for (const [name, dir] of local) {
    const dest = join(TARGET, 'node_modules', name);
    await rm(dest, { recursive: true, force: true });
    await mkdir(dirname(dest), { recursive: true });
    await cp(dir, dest, {
      recursive: true,
      filter: (src) => basename(src) !== 'node_modules',
    });
  }
};

const main = async () => {
  const root = await readJson(join(ROOT, 'package.json'));
  const workspaces = await findWorkspaces();
  const { external, local } = await collect({
    catalog: root.workspaces.catalog,
    workspaces,
  });

  await rm(TARGET, { recursive: true, force: true });
  await mkdir(TARGET, { recursive: true });
  await writeManifest(external);
  // Seeding the root lockfile keeps transitive versions identical to the workspace install.
  await copyFile(join(ROOT, 'bun.lock'), join(TARGET, 'bun.lock'));
  const install = spawnSync('bun', ['install'], {
    cwd: TARGET,
    stdio: 'inherit',
  });
  if (install.status !== 0) throw new Error('bun install failed in sf-deps');
  await copyLocal(local);

  if (!(await exists(join(TARGET, 'node_modules')))) throw new Error('sf-deps has no node_modules');
  console.log(`staged ${TARGET}/node_modules`);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
