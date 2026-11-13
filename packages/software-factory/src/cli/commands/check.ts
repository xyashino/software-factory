import { defineCommand } from 'citty';
import { fileURLToPath } from 'node:url';

/** The package root, two directories above this file's folder: src/cli/commands -> package. */
const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** The repo root, holding `.nitpick/`: two levels above the package. */
const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));

export const checkCommand = defineCommand({
  meta: {
    name: 'check',
    description: 'Validate roles, workflows and templates',
  },
  async run() {
    const [{ loadDefinitions }, { nitpickCatalog }, { default: pc }] =
      await Promise.all([
        import('../../definitions/load'),
        import('../../definitions/nitpick-catalog'),
        import('picocolors'),
      ]);

    const catalog = await nitpickCatalog(REPO_ROOT);
    const result = loadDefinitions(PACKAGE_ROOT, catalog);
    if (!result.ok) {
      console.error(pc.red(`invalid: ${result.error.length} error(s)`));
      for (const error of result.error) {
        console.error(
          `  ${pc.bold(error.file)}  ${error.field}  ${error.message}`,
        );
      }
      process.exitCode = 1;
      return;
    }

    const { roles, workflows, templates, prTemplates } = result.value;
    const { getRunner } = await import('../../adapters/runners/registry');
    const missing = [...workflows.values()].flatMap((workflow) =>
      Object.values(workflow.agents)
        .filter((agent) => getRunner(agent.runner) === undefined)
        .map(
          (agent) =>
            `${workflow.name}: runner "${agent.runner}" has no adapter`,
        ),
    );
    if (missing.length > 0) {
      console.error(pc.red(`invalid: ${missing.length} runner error(s)`));
      for (const line of missing) console.error(`  ${line}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      pc.green(
        `ok: ${roles.size} roles, ${workflows.size} workflows, ${templates.size} templates, ${prTemplates.size} PR templates`,
      ),
    );
  },
});
