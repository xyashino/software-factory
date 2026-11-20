import type {
  RunHandle,
  RunnerPort,
  RunSpec,
} from '../../application/ports/runner.port';

export const createRoutingRunner = (
  headless: RunnerPort,
  interactive: RunnerPort,
): RunnerPort => {
  const owners = new Map<string, RunnerPort>();
  return {
    prepare: () => interactive.prepare(),
    start: async (spec: RunSpec): Promise<RunHandle> => {
      const port = spec.interactive ? interactive : headless;
      const handle = await port.start(spec);
      owners.set(handle.id, port);
      return handle;
    },
    interactiveAvailable: () => interactive.interactiveAvailable(),
    abort: async (handle) => {
      await owners.get(handle.id)?.abort(handle);
    },
    wait: async (handle) => {
      const port = owners.get(handle.id);
      if (port === undefined) throw new Error(`unknown run ${handle.id}`);
      try {
        return await port.wait(handle);
      } finally {
        owners.delete(handle.id);
      }
    },
  };
};
