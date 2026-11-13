import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../../paths';
import { loadPrTemplates, PR_TEMPLATE_VARS } from '../templates';
import { renderTemplate, templateVariables } from '../render';

describe('shipped PR templates', () => {
  it('load with no errors and match their declared variables', () => {
    const loaded = loadPrTemplates(PACKAGE_ROOT);
    expect(loaded.errors).toEqual([]);
    expect([...loaded.templates.keys()].sort()).toEqual(
      Object.keys(PR_TEMPLATE_VARS).sort(),
    );
    for (const [id, allowed] of Object.entries<readonly string[]>(
      PR_TEMPLATE_VARS,
    )) {
      expect(
        templateVariables(loaded.templates.get(id)?.body ?? '').sort(),
      ).toEqual([...allowed].sort());
    }
  });
});

describe('PR template validation', () => {
  let dir: string | undefined;

  const fixture = (files: Record<string, string>): string => {
    dir = mkdtempSync(join(tmpdir(), 'sf-pr-templates-'));
    mkdirSync(join(dir, 'templates', 'pr'), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, 'templates', 'pr', `${name}.md`), body);
    }
    return dir;
  };

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const complete = {
    body: '{{taskId}}{{typeSuffix}}{{objective}}{{changes}}{{adrSection}}{{verificationSection}}{{logCommand}}{{reportSection}}',
    blocked: '{{taskId}}{{reason}}{{detail}}{{logCommand}}',
    report: '{{excerpt}}',
  };

  it('reports a placeholder no contract declares', () => {
    const root = fixture({
      ...complete,
      blocked: '{{taskId}}{{nope}}{{reason}}{{detail}}{{logCommand}}',
    });
    expect(loadPrTemplates(root).errors).toEqual([
      {
        file: 'templates/pr/blocked.md',
        field: 'template',
        message: 'unknown variable {{nope}}',
      },
    ]);
  });

  it('reports a declared variable the template does not use', () => {
    const root = fixture({ ...complete, report: 'no placeholder' });
    expect(loadPrTemplates(root).errors).toEqual([
      {
        file: 'templates/pr/report.md',
        field: 'template',
        message: 'declared variable {{excerpt}} is not used',
      },
    ]);
  });

  it('reports a missing template file', () => {
    const root = fixture({ body: complete.body, blocked: complete.blocked });
    expect(loadPrTemplates(root).errors).toEqual([
      {
        file: 'templates/pr/report.md',
        field: '(file)',
        message: 'template file is missing',
      },
    ]);
  });

  it('reports an unknown template file', () => {
    const root = fixture({ ...complete, extra: 'x' });
    expect(loadPrTemplates(root).errors).toEqual([
      {
        file: 'templates/pr/extra.md',
        field: '(file)',
        message:
          '"extra" is not a known template; add it to PR_TEMPLATE_VARS in src/prompts/templates.ts',
      },
    ]);
  });

  it('refuses to render a missing variable', () => {
    expect(() => renderTemplate('{{a}}', {})).toThrow(
      'missing template variable {{a}}',
    );
  });
});
