// The checker's codes, explained (SPEC §4, §8). Each example is the few files
// a rule needs to see, written into an app root: `test/explain.test.ts` checks
// the wrong one and requires this code, and the right one and requires none.

import { RuleCode, Severity } from '../../../check/src/finding.ts';
import { CaughtBy, type Entry, type ExampleFiles } from './explanation.ts';

const ERROR = { severity: Severity.Error, caughtBy: CaughtBy.Checker } as const;

const WARNING = { severity: Severity.Warning, caughtBy: CaughtBy.Checker } as const;

const CONTRACT = `export interface Device {
  readonly id: string;
  readonly room: string;
}
`;

const STATE = `import { signal, type Accessor } from 'sheratan';

import type { Device } from '../../services/devices.contract.ts';

export interface DevicesState {
  readonly devices: Accessor<readonly Device[]>;
  loaded(this: void, devices: readonly Device[]): void;
}

export function createDevicesState(): DevicesState {
  const devices = signal<readonly Device[]>([]);

  return { devices, loaded: (next) => devices.set(next) };
}
`;

/** A module that uses another through its index, which is how one module reaches another. */
const using = (name: string, other: string): ExampleFiles => ({
  [`modules/${name}/index.ts`]: `export const kind = 'full';\n\nexport const ${name} = '${name}';\n`,
  [`modules/${name}/${name}.effects.ts`]: `import { ${other} } from '../${other}/index.ts';\n\nexport const uses = ${other};\n`,
});

/** Every checker code, keyed by the code itself so a new rule cannot go unexplained. */
export const CHECKER: { readonly [C in RuleCode]: Entry } = {
  [RuleCode.Boundary]: {
    ...ERROR,
    title: 'An import the module matrix does not allow',
    why:
      'Each layer may import only what SPEC §4 lists, so data flows one way: effects → state → view. ' +
      'State that imports an adapter has started doing I/O, and nothing stops the next file doing the same.',
    wrong: {
      'services/devices.contract.ts': CONTRACT,
      'services/devices.http.ts': `export const listDevices = (): string => '/api/devices';\n`,
      'modules/devices/devices.state.ts': `import { listDevices } from '../../services/devices.http.ts';

export const source = listDevices;
`,
    },
    right: {
      'services/devices.contract.ts': CONTRACT,
      'modules/devices/devices.state.ts': STATE,
    },
  },

  [RuleCode.Io]: {
    ...ERROR,
    title: 'A view or a state file does I/O, reads the page or schedules work',
    why:
      'A view is markup as a function of state, and state is signals and pure transitions. ' +
      'Both stay testable without a network or a page only while I/O lives in effects.',
    wrong: {
      'modules/devices/devices.view.ts': `import { html, type Template } from 'sheratan';

export function devicesView(): Template {
  void fetch('/api/devices');

  return html\`<ul></ul>\`;
}
`,
    },
    right: {
      'services/devices.contract.ts': `${CONTRACT}
export interface DeviceApi {
  list(signal: AbortSignal): Promise<readonly Device[]>;
}
`,
      'modules/devices/devices.effects.ts': `import type { DeviceApi } from '../../services/devices.contract.ts';

export function load(api: DeviceApi, signal: AbortSignal): Promise<unknown> {
  return api.list(signal);
}
`,
      'modules/devices/devices.view.ts': `import { html, type Template } from 'sheratan';

export function devicesView(): Template {
  return html\`<ul></ul>\`;
}
`,
    },
  },

  [RuleCode.Structure]: {
    ...ERROR,
    title: 'A file the layout has no place for',
    why:
      'A `shared/` folder becomes the place every file goes when nobody decides where it belongs. ' +
      'A helper is `lib/`, a component is `ui/`, and a feature is a module.',
    wrong: {
      'modules/shared/format.ts': `export const celsius = (value: number): string => \`\${value.toFixed(1)} °C\`;\n`,
    },
    right: {
      'lib/format.ts': `export const celsius = (value: number): string => \`\${value.toFixed(1)} °C\`;\n`,
    },
  },

  [RuleCode.EffectsOnly]: {
    ...ERROR,
    title: 'An effects-only API called outside `*.effects.ts`',
    why:
      '`resource`, `mutation`, `stream`, `onDispose` and `navigate` start or end work in the outside world. ' +
      'Keeping them in effects keeps every side effect of a module in one file.',
    wrong: {
      'modules/clock/clock.view.ts': `import { html, onDispose, type Template } from 'sheratan';

export function clockView(): Template {
  const onVisible = (): void => undefined;

  document.addEventListener('visibilitychange', onVisible);
  onDispose(() => document.removeEventListener('visibilitychange', onVisible));

  return html\`<time>now</time>\`;
}
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
    },
  },

  [RuleCode.Shape]: {
    ...ERROR,
    title: "A module's files do not match the kind its `index.ts` declares",
    why:
      'A module says what it is: `view` is a view and an index, `full` adds state and effects. ' +
      'The declaration is what lets a reader, and the checker, know which files to expect.',
    wrong: {
      'modules/gauge/index.ts': "export const kind = 'full';\n",
      'modules/gauge/gauge.view.ts': "export const gaugeView = (): string => 'gauge';\n",
    },
    right: {
      'modules/gauge/index.ts': "export const kind = 'view';\n",
      'modules/gauge/gauge.view.ts': "export const gaugeView = (): string => 'gauge';\n",
    },
  },

  [RuleCode.Cancellable]: {
    ...ERROR,
    title: 'A promise-returning contract method takes no `AbortSignal`',
    why:
      'A module that unmounts, or a key that changes, abandons the request it started. ' +
      'Without a signal the request runs on, and its answer can land in a screen that has moved on.',
    wrong: {
      'services/devices.contract.ts': `${CONTRACT}
export interface DeviceApi {
  list(): Promise<readonly Device[]>;
}
`,
    },
    right: {
      'services/devices.contract.ts': `${CONTRACT}
export interface DeviceApi {
  list(signal: AbortSignal): Promise<readonly Device[]>;
}
`,
    },
  },

  [RuleCode.Cycle]: {
    ...ERROR,
    title: 'Modules, or `lib/` files, import each other in a loop',
    why:
      'Two modules that use each other are one module in two folders, and the loop decides load order. ' +
      'Whatever both need belongs below both: in `lib/`, or in a contract.',
    wrong: {
      ...using('devices', 'rooms'),
      ...using('rooms', 'devices'),
    },
    right: {
      ...using('devices', 'rooms'),
      'modules/rooms/index.ts': "export const kind = 'view';\n\nexport const rooms = 'rooms';\n",
    },
  },

  [RuleCode.StateSurface]: {
    ...ERROR,
    title: 'A `*.state.ts` hands out a writable `Signal`',
    why:
      'Whoever holds a writable signal can change state from anywhere, and then no transition names the change. ' +
      'An accessor reads; a transition is the one way to write.',
    wrong: {
      'modules/devices/devices.state.ts': `import { signal, type Signal } from 'sheratan';

export interface DevicesState {
  readonly room: Signal<string>;
}

export function createDevicesState(): DevicesState {
  return { room: signal('Lab') };
}
`,
    },
    right: {
      'modules/devices/devices.state.ts': `import { signal, type Accessor } from 'sheratan';

export interface DevicesState {
  readonly room: Accessor<string>;
  moved(this: void, room: string): void;
}

export function createDevicesState(): DevicesState {
  const room = signal('Lab');

  return { room, moved: (next) => room.set(next) };
}
`,
    },
  },

  [RuleCode.Tested]: {
    ...WARNING,
    title: "A module's state or effects has no test beside it",
    why:
      'State is pure functions and effects need one fake contract, so both are cheap to test, and they are ' +
      'where the logic is. The test sits beside the file it covers, under its name, so a missing one shows.',
    wrong: {
      'services/devices.contract.ts': CONTRACT,
      'modules/devices/devices.state.ts': STATE,
    },
    right: {
      'services/devices.contract.ts': CONTRACT,
      'modules/devices/devices.state.ts': STATE,
      'modules/devices/devices.state.test.ts': `import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDevicesState } from './devices.state.ts';

test('a load replaces the devices', () => {
  const state = createDevicesState();

  state.loaded([{ id: 'd1', room: 'Lab' }]);

  assert.equal(state.devices().length, 1);
});
`,
    },
  },
};
