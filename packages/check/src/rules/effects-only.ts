// SHR-L004 (SPEC §4): the effects-only APIs are called in `*.effects.ts` and
// nowhere else. Each starts something that outlives the call — a request, a
// subscription, a teardown — and the module contract keeps
// everything that outlives a call in one file, so there is one place to read
// when a module leaks, refetches, or navigates when it should not.
//
// Only a call to the runtime's own export counts, resolved through the import
// binding: a local function named `stream` is not this `stream`, and neither
// is one imported from somewhere else.

import { docsFor, RuleCode, Severity, type Finding } from '../finding.ts';
import { Layer, NO_MODULE, placeOf, type Place } from '../layout.ts';
import type { CallUse, Program } from '../typescript.ts';

// SPEC §4 names a fifth, `navigate()`. It joins this map when the router
// exports it: a rule cannot resolve an import that does not exist.

/** The package these APIs come from; a same-named export of another is not one. */
const RUNTIME = 'sheratan';

/** Where a fix points when the file belongs to no module of its own. */
const SOME_EFFECTS_FILE = 'the effects file of a module';

/** What an effects-only API starts, and where the caller should have started it. */
interface Api {
  /** Why it outlives the call, which is why it belongs with the I/O. */
  readonly does: string;
  readonly fix: (effects: string) => string;
}

const EFFECTS_ONLY: ReadonlyMap<string, Api> = new Map([
  [
    'resource',
    {
      does: 'reads data asynchronously',
      fix: (effects: string) =>
        `Create it in ${effects} and pass what it reads to a transition; the view reads state.`,
    },
  ],
  [
    'mutation',
    {
      does: 'writes through a service',
      fix: (effects: string) =>
        `Create it in ${effects} and expose it as an intent the view triggers.`,
    },
  ],
  [
    'stream',
    {
      does: 'subscribes to a source',
      fix: (effects: string) =>
        `Open it in ${effects} and record each message through a transition; the view reads state.`,
    },
  ],
  [
    'onDispose',
    {
      does: 'registers teardown the runtime cannot see',
      fix: (effects: string) => `Register the teardown in ${effects}, beside the thing it undoes.`,
    },
  ],
]);

/** The module's own effects file, or any module's when the file is not in one. */
function effectsFile(place: Place): string {
  return place.module === NO_MODULE ? SOME_EFFECTS_FILE : `${place.module}.effects.ts`;
}

function finding(place: Place, { name, at }: CallUse, api: Api): Finding {
  const effects = effectsFile(place);

  return {
    code: RuleCode.EffectsOnly,
    severity: Severity.Error,
    file: place.path,
    range: at,
    message: `${place.path} calls \`${name}()\`, which ${api.does}; only ${effects} may call it.`,
    fix: api.fix(effects),
    docs: docsFor(RuleCode.EffectsOnly),
  };
}

/** Every effects-only API called outside the one file that may call it. */
export function effectsOnly(program: Program, root: string): Finding[] {
  return program.files.flatMap((file) => {
    const place = placeOf(root, file);

    if (place === undefined || place.layer === Layer.Effects) return [];

    return program.callsOf(file).flatMap((call) => {
      const api = call.from === RUNTIME ? EFFECTS_ONLY.get(call.name) : undefined;

      return api === undefined ? [] : [finding(place, call, api)];
    });
  });
}
