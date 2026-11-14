/**
 * A fake `gh` for the distributed suite: the pull requests live in `FAKE_GH_DIR`, one JSON file per
 * branch, so every process of the suite (the server's PR poll and each Cell's delivery) sees the same
 * GitHub. It answers the three calls the Factory makes: `pr list --head`, `pr create` and `pr view`.
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
  const found = prsOnDisk()
    .filter((pr) => pr.branch === head)
    .map(({ number, url, state }) => ({ number, url, state }));
  process.stdout.write(`${JSON.stringify(found)}\n`);
} else if (verb === 'create') {
  const branch = flag(rest, '--head') ?? fail('pr create needs --head');
  const title = flag(rest, '--title') ?? branch;
  const url = `https://github.test/fake/software-factory/pull/${encodeURIComponent(branch)}`;
  const pr: FakePr = {
    branch,
    url,
    number: prsOnDisk().length + 1,
    state: 'OPEN',
    title,
  };
  if (!existsSync(dir())) fail(`FAKE_GH_DIR ${dir()} does not exist`);
  writeFileSync(fileOf(branch), JSON.stringify(pr));
  process.stdout.write(`${url}\n`);
} else if (verb === 'view') {
  const url = rest[0];
  const pr = prsOnDisk().find((candidate) => candidate.url === url);
  if (pr === undefined) fail(`no pull request at ${url}`);
  process.stdout.write(`${pr?.state ?? 'OPEN'}\n`);
} else {
  fail(`fake gh does not answer pr ${verb ?? '(nothing)'}`);
}
