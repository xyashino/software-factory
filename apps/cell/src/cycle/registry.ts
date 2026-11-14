/** A running Operator station the Cell can ask to hand over when it leaves (PROTOCOL §9). */
export interface RunHandle {
  readonly jobId: string;
  /** Types the handover request; the Operator's Handover then ends the Cycle as `handed_over`. */
  leave(): void;
}

export interface StationRegistry {
  add(handle: RunHandle): void;
  delete(handle: RunHandle): void;
  all(): readonly RunHandle[];
}

/** The live stations of one Cell. A leaving Cell asks each of them to hand over. */
export const createRegistry = (): StationRegistry => {
  const handles = new Set<RunHandle>();
  return {
    add: (handle) => {
      handles.add(handle);
    },
    delete: (handle) => {
      handles.delete(handle);
    },
    all: () => [...handles],
  };
};
