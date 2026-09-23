// The module's only public surface (SPEC §4).

import type { ModuleView } from 'sheratan';

import { notFoundView } from './not-found.view.ts';

/** `view`: markup only, so this module has no state and no effects (SHR-L006). */
export const kind = 'view';

/** The outer table's `'*'` row. */
export function createNotFound(): ModuleView {
  return notFoundView;
}
