import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_PATTERN = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const INLINE_CODE_PATTERN = /`[^`]*`/g;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const FENCE_PATTERN = /^\s*(```|~~~)/;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), '..');

export type DeadLink = { file: string; link: string };

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdown(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

function packageReadmes(root: string, parent: string): string[] {
  const dir = join(root, parent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, 'README.md'))
    .filter((path) => existsSync(path));
}

function docFiles(root: string): string[] {
  return [
    ...(existsSync(join(root, 'README.md')) ? [join(root, 'README.md')] : []),
    ...listMarkdown(join(root, 'docs')),
    ...packageReadmes(root, 'apps'),
    ...packageReadmes(root, 'packages'),
  ];
}

function linkTargets(markdown: string): string[] {
  let inFence = false;
  return markdown.split('\n').flatMap((line) => {
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      return [];
    }
    if (inFence) return [];
    const prose = line.replace(INLINE_CODE_PATTERN, '');
    return [...prose.matchAll(LINK_PATTERN)].flatMap((match) =>
      match[1] ? [match[1]] : [],
    );
  });
}

function isRelativeFileLink(target: string): boolean {
  return (
    !target.startsWith('#') &&
    !target.startsWith('/') &&
    !SCHEME_PATTERN.test(target)
  );
}

function deadLinksIn(root: string, file: string): DeadLink[] {
  const targets = linkTargets(readFileSync(file, 'utf8')).filter(
    isRelativeFileLink,
  );
  return targets
    .filter((target) => {
      const [path = ''] = target.split('#');
      return path !== '' && !existsSync(resolve(dirname(file), path));
    })
    .map((link) => ({ file: relative(root, file), link }));
}

export function findDeadLinks(root: string = DEFAULT_ROOT): DeadLink[] {
  return docFiles(root).flatMap((file) => deadLinksIn(root, file));
}

const invokedDirectly = process.argv[1] === SCRIPT_PATH;

if (invokedDirectly) {
  const root = resolve(process.argv[2] ?? DEFAULT_ROOT);
  const dead = findDeadLinks(root);
  if (dead.length === 0) {
    console.log('docs:check ok: no dead relative doc links');
  } else {
    for (const { file, link } of dead) {
      console.error(`${file} -> ${link}`);
    }
    console.error(`docs:check failed: ${dead.length} dead doc link(s)`);
    process.exitCode = 1;
  }
}
