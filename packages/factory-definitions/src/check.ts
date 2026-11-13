import type { OrderId, ProjectId } from '@repo/factory-core/ids';
import type { DefinitionError } from './errors';
import { readDefinitions } from './load';
import type { NitpickCatalog } from './nitpick-catalog';
import { scanTodos } from './todo-scan';
import type { TodoSource } from './todo';

export interface CheckOptions {
  /** `.nitpick` catalog: declared rules and skills must exist there */
  catalog?: NitpickCatalog;
  /** todo files to scan against the Lines that loaded */
  todos?: {
    projectId: ProjectId;
    files: readonly TodoSource[];
    /** OrderIds that already have a Work order */
    knownOrderIds?: ReadonlySet<OrderId>;
  };
}

/**
 * Every definition error under `packageRoot`, with file and field: the
 * function behind `factory check`. An empty list means the definitions pass.
 */
export const check = (
  packageRoot: string,
  options: CheckOptions = {},
): DefinitionError[] => {
  const { definitions, errors } = readDefinitions(packageRoot, options.catalog);
  if (options.todos === undefined) {
    return errors;
  }
  const scan = scanTodos(
    options.todos.projectId,
    options.todos.files,
    new Set(definitions.lines.keys()),
    options.todos.knownOrderIds,
  );
  return [
    ...errors,
    ...scan.diagnostics.map(({ file, field, message }) => ({
      file,
      field,
      message,
    })),
  ];
};
