import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(
  process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)),
);
const LINK_PATTERN = /\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const CODE_SPAN_PATTERN = /`[^`]*`/g;
const FENCE_PATTERN = /^\s*(```|~~~)/;
const NOT_LOCAL_PATTERN = /^(#|\/\/|[a-z][a-z0-9+.-]*:)/i;

type DeadLink = { readonly file: string; readonly link: string };

const markdownIn = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => join(dir, entry))
    : [];

const readmesIn = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .map((name) => join(dir, name, 'README.md'))
        .filter((file) => existsSync(file))
    : [];

const docFiles = (root: string): string[] => [
  ...markdownIn(join(root, 'docs')),
  ...[join(root, 'README.md')].filter((file) => existsSync(file)),
  ...readmesIn(join(root, 'apps')),
  ...readmesIn(join(root, 'packages')),
];

const localLinks = (markdown: string): string[] => {
  let inFence = false;
  return markdown.split('\n').flatMap((line) => {
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      return [];
    }
    if (inFence) return [];
    return [...line.replace(CODE_SPAN_PATTERN, '').matchAll(LINK_PATTERN)]
      .flatMap(([, link]) => (link ? [link] : []))
      .filter((link) => !NOT_LOCAL_PATTERN.test(link));
  });
};

const targetOf = (file: string, link: string): string => {
  const path = link.replace(/#.*$/, '');
  return path.startsWith('/') ? join(ROOT, path) : resolve(dirname(file), path);
};

const findDeadLinks = (files: string[]): DeadLink[] =>
  files.flatMap((file) =>
    localLinks(readFileSync(file, 'utf8'))
      .filter((link) => !existsSync(targetOf(file, link)))
      .map((link) => ({
        file: relative(ROOT, file).split(sep).join('/'),
        link,
      })),
  );

const files = docFiles(ROOT);
const deadLinks = findDeadLinks(files);

if (deadLinks.length === 0) {
  console.log(`docs:check passed: ${files.length} files`);
} else {
  for (const { file, link } of deadLinks) {
    console.error(`${file} -> ${link}`);
  }
  console.error(`docs:check failed: ${deadLinks.length} dead link(s)`);
  process.exitCode = 1;
}
