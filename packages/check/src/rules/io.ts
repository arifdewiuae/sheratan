// SHR-L002 (SPEC §4): views and state do no I/O. A view is markup as a function
// of state, and state is signals plus pure transitions; the moment either
// fetches, stores, schedules or touches the page, it can no longer be tested
// by calling it, and the one place an app's I/O happens is no longer one place.
//
// Only the platform's own globals count, resolved by the type checker: a local
// variable called `document` is not the page, and `window.fetch` is reported
// once, at `window`.

import { docsFor, RuleCode, Severity, type Finding } from '../finding.ts';
import { Layer, placeOf, type Place } from '../layout.ts';
import type { GlobalUse, Program } from '../typescript.ts';

/** What a global does, which decides where it belongs instead. */
const IoKind = {
  Network: 'network',
  Storage: 'storage',
  Timer: 'timer',
  Page: 'page',
} as const;

type IoKind = (typeof IoKind)[keyof typeof IoKind];

const IO_GLOBALS: ReadonlyMap<string, IoKind> = new Map([
  ['fetch', IoKind.Network],
  ['XMLHttpRequest', IoKind.Network],
  ['WebSocket', IoKind.Network],
  ['EventSource', IoKind.Network],
  ['localStorage', IoKind.Storage],
  ['sessionStorage', IoKind.Storage],
  ['indexedDB', IoKind.Storage],
  ['caches', IoKind.Storage],
  ['setTimeout', IoKind.Timer],
  ['setInterval', IoKind.Timer],
  ['requestAnimationFrame', IoKind.Timer],
  ['requestIdleCallback', IoKind.Timer],
  ['document', IoKind.Page],
  ['window', IoKind.Page],
  ['globalThis', IoKind.Page],
  ['self', IoKind.Page],
  ['navigator', IoKind.Page],
  ['location', IoKind.Page],
  ['history', IoKind.Page],
  ['alert', IoKind.Page],
  ['confirm', IoKind.Page],
  ['prompt', IoKind.Page],
]);

/** The layers that may not do I/O, and what each may do instead. */
const ALLOWED: ReadonlyMap<Layer, string> = new Map([
  [Layer.View, 'allowed in a view: markup from state, and intents that effects carry out'],
  [Layer.ModuleFile, 'allowed in a view: markup from state, and intents that effects carry out'],
  [Layer.State, 'allowed in state: signals, computeds and pure transitions'],
]);

/** The module's own effects and state files, which is where each fix points. */
interface Home {
  readonly effects: string;
  readonly state: string;
}

const FIXES: Readonly<Record<IoKind, (home: Home) => string>> = {
  [IoKind.Network]: ({ effects, state }) =>
    `Call it from ${effects} through a service contract (services/*.contract.ts), and hand the result to a transition in ${state}.`,
  [IoKind.Storage]: ({ effects, state }) =>
    `Read and write storage in ${effects}, behind a service contract, and pass what it holds to a transition in ${state}.`,
  [IoKind.Timer]: ({ effects, state }) =>
    `Schedule it in ${effects} and cancel it in onDispose(); record what it produces through a transition in ${state}.`,
  [IoKind.Page]: ({ effects, state }) =>
    `Read or change the page from ${effects}, passing any value to a transition in ${state}; a view changes the page only through the markup html\`\` returns.`,
};

function finding(place: Place, allowed: string, { name, at }: GlobalUse, kind: IoKind): Finding {
  const home = { effects: `${place.module}.effects.ts`, state: `${place.module}.state.ts` };

  return {
    code: RuleCode.Io,
    severity: Severity.Error,
    file: place.path,
    range: at,
    message: `${place.path} uses \`${name}\`, which is ${kind} I/O; ${allowed}.`,
    fix: FIXES[kind](home),
    docs: docsFor(RuleCode.Io),
  };
}

/** Every I/O global a view, a state file or a module's own helper touches. */
export function io(program: Program, root: string): Finding[] {
  return program.files.flatMap((file) => {
    const place = placeOf(root, file);
    const allowed = place === undefined ? undefined : ALLOWED.get(place.layer);

    if (place === undefined || allowed === undefined) return [];

    return program.globalsOf(file).flatMap((use) => {
      const kind = IO_GLOBALS.get(use.name);

      return kind === undefined ? [] : [finding(place, allowed, use, kind)];
    });
  });
}
