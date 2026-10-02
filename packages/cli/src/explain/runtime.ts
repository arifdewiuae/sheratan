// The runtime's codes, explained (SPEC §8, §13). Each example is an `app.ts`
// that renders into the page, because that is the smallest thing a reader can
// run; a wrong one throws its code and a right one does not, which
// `test/explain.test.ts` proves by running both.

import { Severity } from '../../../check/src/finding.ts';
import { ErrorCode } from '../../../core/src/codes.ts';
import { CaughtBy, type Entry } from './explanation.ts';

/** The file every runtime example is written as. */
const APP = 'app.ts';

/** A runtime code is always an error: it was thrown. */
const THROWN = { severity: Severity.Error, caughtBy: CaughtBy.Runtime } as const;

/** Every runtime code, keyed by the code itself so a new one cannot go unexplained. */
export const RUNTIME: { readonly [C in ErrorCode]: Entry } = {
  [ErrorCode.DisposeOutsideOwner]: {
    ...THROWN,
    title: '`onDispose()` was called with no module mounting',
    why:
      'Teardown belongs to the module that set something up, so it runs when that module unmounts. ' +
      'Called at the top of a file there is no module to belong to, and the teardown would never run.',
    wrong: {
      [APP]: `import { onDispose } from 'sheratan';

const onVisible = (): void => undefined;

document.addEventListener('visibilitychange', onVisible);
onDispose(() => document.removeEventListener('visibilitychange', onVisible));
`,
    },
    right: {
      'modules/clock/clock.effects.ts': `import { onDispose } from 'sheratan';

export function startClock(): void {
  const onVisible = (): void => undefined;

  document.addEventListener('visibilitychange', onVisible);
  onDispose(() => document.removeEventListener('visibilitychange', onVisible));
}
`,
      'modules/clock/index.ts': `import { html, type Template } from 'sheratan';

import { startClock } from './clock.effects.ts';

export const kind = 'full';

export function createClock(): () => Template {
  return () => {
    startClock();

    return html\`<time>now</time>\`;
  };
}
`,
      [APP]: `import { render } from 'sheratan';

import { createClock } from './modules/clock/index.ts';

const dispose = render(createClock(), document.body);

dispose();
`,
    },
  },

  [ErrorCode.WatchersDidNotSettle]: {
    ...THROWN,
    title: 'A watcher kept writing a signal it reads, and never settled',
    why:
      'A watcher re-runs when what it read changes. One that writes what it reads triggers itself, ' +
      'forever; the runtime stops it after a fixed number of runs rather than freeze the page.',
    wrong: {
      [APP]: `import { signal, watch } from 'sheratan';

const readings = signal([21, 22]);
const count = signal(0);

watch(() => {
  readings();
  count.set(count() + 1);
});
`,
    },
    right: {
      [APP]: `import { computed, signal, watch } from 'sheratan';

const readings = signal([21, 22]);
const count = computed(() => readings().length);

watch(() => {
  document.title = \`\${String(count())} readings\`;
});
`,
    },
  },

  [ErrorCode.PartialAttributeHole]: {
    ...THROWN,
    title: 'A hole inside a tag was only part of an attribute value',
    why:
      'A hole in a tag binds one whole attribute, so it can be updated by itself. ' +
      'Half of one would have to be stitched back to a string on every change.',
    wrong: {
      [APP]: `import { html, render, signal } from 'sheratan';

const tone = signal('ok');

render(() => html\`<p class="tile \${tone}">22 °C</p>\`, document.body);
`,
    },
    right: {
      [APP]: `import { computed, html, render, signal } from 'sheratan';

const tone = signal('ok');
const tileClass = computed(() => \`tile \${tone()}\`);

render(() => html\`<p class=\${tileClass}>22 °C</p>\`, document.body);
`,
    },
  },

  [ErrorCode.UnreachableHole]: {
    ...THROWN,
    title: 'A hole sat where the HTML parser cannot keep its marker',
    why:
      'Inside a raw-text element such as `<style>`, `<textarea>` or `<title>` the parser keeps everything as text, ' +
      'so there is no node for the hole to update. Bind the value somewhere a hole can reach: a whole attribute, or a property.',
    wrong: {
      [APP]: `import { html, render, signal } from 'sheratan';

const accent = signal('teal');

render(() => html\`<style>.tile { color: \${accent}; }</style><p class="tile">22 °C</p>\`, document.body);
`,
    },
    right: {
      [APP]: `import { computed, html, render, signal } from 'sheratan';

const accent = signal('teal');
const tileStyle = computed(() => \`color: \${accent()}\`);

render(() => html\`<p class="tile" style=\${tileStyle}>22 °C</p>\`, document.body);
`,
    },
  },

  [ErrorCode.EventHoleNotFunction]: {
    ...THROWN,
    title: 'An `@event` hole received something other than a function',
    why:
      'An event hole takes the intent itself, and the runtime calls it when the event fires. ' +
      'Calling it while writing the template runs it once, at render, and hands the hole its result.',
    wrong: {
      [APP]: `import { html, render } from 'sheratan';

const calibrate = (): void => undefined;

render(() => html\`<button @click=\${calibrate()}>Calibrate</button>\`, document.body);
`,
    },
    right: {
      [APP]: `import { html, render } from 'sheratan';

const calibrate = (): void => undefined;

render(() => html\`<button @click=\${calibrate}>Calibrate</button>\`, document.body);
`,
    },
  },

  [ErrorCode.EachItemWithoutId]: {
    ...THROWN,
    title: 'An `each()` item is an object with no `id`',
    why:
      '`each()` keys a row by its item, so it can move a row instead of rebuilding it. ' +
      'An object is keyed by its `id`; without one there is nothing stable to follow.',
    wrong: {
      [APP]: `import { each, html, render } from 'sheratan';

const rooms = [{ name: 'Lab' }, { name: 'Office' }];

render(() => html\`<ul>\${each(rooms, (room) => html\`<li>\${room().name}</li>\`)}</ul>\`, document.body);
`,
    },
    right: {
      [APP]: `import { each, html, render } from 'sheratan';

const rooms = [
  { id: 'lab', name: 'Lab' },
  { id: 'office', name: 'Office' },
];

render(() => html\`<ul>\${each(rooms, (room) => html\`<li>\${room().name}</li>\`)}</ul>\`, document.body);
`,
    },
  },

  [ErrorCode.EachDuplicateKey]: {
    ...THROWN,
    title: 'Two `each()` items have the same key',
    why:
      'A key says which row is which. Two rows with one key cannot be told apart, ' +
      'so an update could move, keep or drop the wrong one.',
    wrong: {
      [APP]: `import { each, html, render } from 'sheratan';

const rooms = ['Lab', 'Office', 'Lab'];

render(() => html\`<ul>\${each(rooms, (room) => html\`<li>\${room}</li>\`)}</ul>\`, document.body);
`,
    },
    right: {
      [APP]: `import { each, html, render } from 'sheratan';

const rooms = [...new Set(['Lab', 'Office', 'Lab'])];

render(() => html\`<ul>\${each(rooms, (room) => html\`<li>\${room}</li>\`)}</ul>\`, document.body);
`,
    },
  },

  [ErrorCode.ArrayInHole]: {
    ...THROWN,
    title: 'An array reached a hole; rendering many is what `each()` is for',
    why:
      'An array in a hole would be rebuilt whole on every change, losing focus and scroll in every row. ' +
      '`each()` keys the rows and updates only the ones that changed.',
    wrong: {
      [APP]: `import { html, render } from 'sheratan';

const rooms = ['Lab', 'Office'];

render(() => html\`<ul>\${rooms.map((room) => html\`<li>\${room}</li>\`)}</ul>\`, document.body);
`,
    },
    right: {
      [APP]: `import { each, html, render } from 'sheratan';

const rooms = ['Lab', 'Office'];

render(() => html\`<ul>\${each(rooms, (room) => html\`<li>\${room}</li>\`)}</ul>\`, document.body);
`,
    },
  },

  [ErrorCode.MountedTwice]: {
    ...THROWN,
    title: 'One `mount()` was placed in two holes',
    why:
      'A mounted module has one lifetime: it is created where it is placed and disposed when it leaves. ' +
      'In two places at once, it would be disposed by whichever left first.',
    wrong: {
      [APP]: `import { html, mount, render } from 'sheratan';

const gauge = () => html\`<meter value="0.4"></meter>\`;
const placed = mount(gauge);

render(() => html\`<main>\${placed}\${placed}</main>\`, document.body);
`,
    },
    right: {
      [APP]: `import { html, mount, render } from 'sheratan';

const gauge = () => html\`<meter value="0.4"></meter>\`;

render(() => html\`<main>\${mount(gauge)}\${mount(gauge)}</main>\`, document.body);
`,
    },
  },
};
