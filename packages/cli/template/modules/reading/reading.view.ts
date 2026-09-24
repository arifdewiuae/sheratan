// A `view` module: markup as a pure function of the props its parent passes
// (SPEC §4). It owns no state, so it has no state or effects file, and the
// value arrives as an accessor — this module's own hole reads it, so a new
// reading rewrites one text node and the parent's row is left alone.

import { computed, html, type Accessor, type Template } from 'sheratan';

import { celsius } from '../../lib/units.ts';
import type { Limits } from '../../services/devices.contract.ts';

/** What a parent hands this module. */
export interface ReadingProps {
  readonly value: Accessor<number>;
  readonly limits: Accessor<Limits>;
}

/** One reading, marked when it sits outside the site's band. */
export function readingView(props: ReadingProps): Template {
  const text = computed(() => celsius(props.value()));

  const tone = computed(() => {
    const { low, high } = props.limits();
    const value = props.value();

    return value < low || value > high ? 'reading out' : 'reading';
  });

  // Its own module root, so this module's sheet scopes to it and the parent's
  // lower boundary stops here (SPEC §9a).
  return html`<span class="module-reading" data-module="reading">
    <span class=${tone} data-reading>${text}</span>
  </span>`;
}
