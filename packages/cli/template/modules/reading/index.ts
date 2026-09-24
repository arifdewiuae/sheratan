// The module's only public surface (SPEC §4).

import type { ModuleView } from 'sheratan';

import { readingView, type ReadingProps } from './reading.view.ts';

export type { ReadingProps };

/** `view`: markup only, so this module has no state and no effects (SHR-L006). */
export const kind = 'view';

/** One device's reading, judged against the site's band. */
export function createReading(): ModuleView<ReadingProps> {
  return readingView;
}
