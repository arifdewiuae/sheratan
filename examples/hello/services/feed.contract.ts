// The interface modules depend on (SPEC §4b). Nothing above this line knows
// whether the numbers come from a socket, a poll, or a generator.

/** One row of the dashboard. */
export interface Metric {
  readonly id: number;
  readonly name: string;
  readonly value: number;
  /** Change from the previous value, for the direction arrow. */
  readonly delta: number;
}

/** One value arriving from the feed. */
export interface Tick {
  readonly id: number;
  readonly value: number;
}

/** A live source of metric updates. */
export interface FeedApi {
  /** The initial rows. Takes an `AbortSignal` (SHR-L007). */
  snapshot(signal: AbortSignal): Promise<readonly Metric[]>;
  /**
   * Streams batches until `signal` aborts. Batches, not single values: a feed
   * that delivers thousands a second should not cost thousands of calls.
   */
  subscribe(onBatch: (ticks: readonly Tick[]) => void, signal: AbortSignal): void;
}
