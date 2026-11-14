/**
 * A fake `gh` for the distributed suite: the pull requests live in `FAKE_GH_DIR`, one JSON file per
 * branch, so every process of the suite (the server's PR poll and each Cell's delivery) sees the same
 * GitHub. It answers the calls the Factory makes: `pr list --head [--base]`, `pr create`, `pr view`
 * (state with `--jq .state`, or `isDraft` with `--json isDraft`), `pr ready` and `pr edit --body-file -`.
 * A merge is not a `gh` call: the test merges in git and then writes the PR's state here.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type PrState = 'OPEN' | 'MERGED' | 'CLOSED';

interface FakePr {
  branch: string;
  url: string;
  number: number;
  state: PrState;
  title: string;
  /** The base branch the PR targets. Optional on disk: a PR written before this field has none. */
  base?: string;
  /** Whether the PR is a draft. Optional on disk: an older PR is not a draft. */
  draft?: boolean;
  /** The PR body, as the last `create` or `edit` set it. */
  body?: string;
}

const dir = (): string => {
  const value = process.env.FAKE_GH_DIR;
  if (value === undefined) throw new Error('FAKE_GH_DIR is not set');
  return value;
};

const fileOf = (branch: string): string =>
  join(dir(), `${branch.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

const prsOnDisk = (): FakePr[] =>
  readdirSync(dir())
    .filter((name) => name.endsWith('.json'))
    .map(
      (name) => JSON.parse(readFileSync(join(dir(), name), 'utf8')) as FakePr,
    );

const writePr = (pr: FakePr): void => {
  writeFileSync(fileOf(pr.branch), JSON.stringify(pr));
};

const flag = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const [group, verb, ...rest] = process.argv.slice(2);

if (group !== 'pr') fail(`fake gh does not answer ${group ?? '(nothing)'}`);

if (verb === 'list') {
  const head = flag(rest, '--head');
  const base = flag(rest, '--base');
  const found = prsOnDisk()
    .filter((pr) => pr.branch === head)
    .filter((pr) => base === undefined || pr.base === base)
    .map((pr) => ({
      number: pr.number,
      url: pr.url,
      state: pr.state,
      isDraft: pr.draft === true,
    }));
  process.stdout.write(`${JSON.stringify(found)}\n`);
} else if (verb === 'create') {
  const branch = flag(rest, '--head') ?? fail('pr create needs --head');
  const title = flag(rest, '--title') ?? branch;
  const base = flag(rest, '--base') ?? 'main';
  const body = flag(rest, '--body') ?? '';
  const url = `https://github.test/fake/software-factory/pull/${encodeURIComponent(branch)}`;
  if (!existsSync(dir())) fail(`FAKE_GH_DIR ${dir()} does not exist`);
  const pr: FakePr = {
    branch,
    url,
    number: prsOnDisk().length + 1,
    state: 'OPEN',
    title,
    base,
    draft: rest.includes('--draft'),
    body,
  };
  writePr(pr);
  process.stdout.write(`${url}\n`);
} else if (verb === 'view') {
  const url = rest[0];
  const pr = prsOnDisk().find((candidate) => candidate.url === url);
  if (pr === undefined) fail(`no pull request at ${url}`);
  if (flag(rest, '--json') === 'isDraft') {
    process.stdout.write(
      `${JSON.stringify({ isDraft: pr?.draft === true })}\n`,
    );
  } else {
    process.stdout.write(`${pr?.state ?? 'OPEN'}\n`);
  }
} else if (verb === 'ready') {
  const url = rest[0];
  const pr = prsOnDisk().find((candidate) => candidate.url === url);
  if (pr === undefined) fail(`no pull request at ${url}`);
  if (pr !== undefined) writePr({ ...pr, draft: false });
} else if (verb === 'edit') {
  const url = rest[0];
  const pr = prsOnDisk().find((candidate) => candidate.url === url);
  if (pr === undefined) fail(`no pull request at ${url}`);
  // The body arrives on stdin (`--body-file -`).
  const body = readFileSync(0, 'utf8');
  if (pr !== undefined) writePr({ ...pr, body });
} else {
  fail(`fake gh does not answer pr ${verb ?? '(nothing)'}`);
}
