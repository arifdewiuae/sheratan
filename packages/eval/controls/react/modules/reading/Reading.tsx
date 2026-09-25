// A view-only module: markup as a pure function of the props its parent
// passes. It owns no state, so it has no store and no queries, and it takes
// the number rather than reading it — the parent already has it.

import type { JSX } from 'react';

import { celsius } from '../../lib/units.ts';
import type { Limits } from '../../services/devices.contract.ts';

/** What a parent hands this module. */
export interface ReadingProps {
  readonly value: number;
  readonly limits: Limits;
}

/** One reading, marked when it sits outside the site's band. */
export function Reading({ value, limits }: ReadingProps): JSX.Element {
  const tone = value < limits.low || value > limits.high ? 'reading out' : 'reading';

  // Its own module root, so this module's sheet scopes to it and the parent's
  // lower boundary stops here.
  return (
    <span className="module-reading" data-module="reading">
      <span className={tone} data-reading>
        {celsius(value)}
      </span>
    </span>
  );
}
