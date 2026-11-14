/** The state a pull request can be in, as the runtime records it (`RecordPrState`, CORE §5.2). */
export type PrState = 'open' | 'merged' | 'closed';

/** Reads the current state of a delivered Work order's pull request (PROTOCOL §8). */
export interface PrStatePort {
  read(prUrl: string): Promise<PrState>;
}
