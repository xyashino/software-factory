import type { PrPort, PrSpec } from '../../application/ports/pr.port';
import type { ProcessPort } from '../../application/ports/process.port';

const GH = 'gh';

const publishArgs = (existing: boolean, spec: PrSpec): string[] =>
  existing
    ? ['pr', 'edit', spec.branch, '--title', spec.title, '--body', spec.body]
    : [
        'pr',
        'create',
        '--base',
        spec.baseBranch,
        '--head',
        spec.branch,
        '--title',
        spec.title,
        '--body',
        spec.body,
      ];

export const createPrAdapter = (process: ProcessPort): PrPort => ({
  publish: async (spec) => {
    const view = await process.run(
      GH,
      ['pr', 'view', spec.branch, '--json', 'number'],
      spec.cwd,
    );
    const result = await process.run(
      GH,
      publishArgs(view.exitCode === 0, spec),
      spec.cwd,
    );
    if (result.exitCode !== 0) {
      throw new Error(`gh pr failed: ${result.stderr.trim()}`);
    }
  },
});
