// A terminal that keeps what was written to it, so a test can run the whole
// command and read back the two streams separately.

import type { Terminal } from '../src/index.ts';

/** A {@link Terminal} plus what it has been told. */
export interface Recorder {
  readonly terminal: Terminal;
  /** Everything written to stdout, one entry per call. */
  readonly out: string[];
  /** Everything written to stderr, one entry per call. */
  readonly err: string[];
}

/** A terminal that records instead of printing. Colour is off unless asked for. */
export function recorder(colour = false): Recorder {
  const out: string[] = [];
  const err: string[] = [];

  return {
    out,
    err,
    terminal: {
      colour,
      out: (text) => {
        out.push(text);
      },
      err: (text) => {
        err.push(text);
      },
    },
  };
}
