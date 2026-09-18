// The import matrix (SPEC §4): one table an agent can hold in context. Every
// cell reports as one code, SHR-L001, and the message names the allowed set
// rather than a rule number — for a one-turn repair that beats a link.

import { Layer, NO_MODULE, type Place } from './layout.ts';

/** A disallowed import, worded for whoever has to fix it. */
export interface Verdict {
  readonly message: string;
  readonly fix: string;
}

/** An import, as the matrix sees it. */
export interface Crossing {
  readonly from: Place;
  readonly to: Place;
  /** Erased at run time, which is what the contract exception turns on. */
  readonly typeOnly: boolean;
}

/** The files that belong to a module, and so fall under "own module". */
const MODULE_LAYERS: readonly Layer[] = [
  Layer.State,
  Layer.Effects,
  Layer.View,
  Layer.Index,
  Layer.ModuleFile,
];

/** One row of the matrix: what a layer may import, and how a message names it. */
interface Row {
  readonly name: string;
  /** The allowed set, as the message states it. */
  readonly allowed: string;
  /** Allowed from anywhere. */
  readonly anywhere: readonly Layer[];
  /** Allowed only inside the importer's own module. */
  readonly own: readonly Layer[];
  /** Allowed only from a different module. */
  readonly other: readonly Layer[];
}

const EVERY_LAYER: readonly Layer[] = Object.values(Layer);

const NONE: readonly Layer[] = [];

const LOCAL_READS: readonly Layer[] = [Layer.State, Layer.View, Layer.ModuleFile];

const SERVICE_ROW: Row = {
  name: 'services/',
  allowed: 'lib, services',
  anywhere: [Layer.Lib, Layer.Service, Layer.Contract],
  own: NONE,
  other: NONE,
};

/** SPEC §4's table, row for row. */
const MATRIX: Readonly<Record<Layer, Row>> = {
  [Layer.Lib]: {
    name: 'lib/',
    allowed: 'lib, never back round to itself',
    anywhere: [Layer.Lib],
    own: NONE,
    other: NONE,
  },
  [Layer.Ui]: {
    name: 'ui/',
    allowed: 'lib, ui',
    anywhere: [Layer.Lib, Layer.Ui],
    own: NONE,
    other: NONE,
  },
  [Layer.Service]: SERVICE_ROW,
  [Layer.Contract]: SERVICE_ROW,
  [Layer.State]: {
    name: 'state',
    allowed: 'lib, own module',
    anywhere: [Layer.Lib],
    own: [Layer.State, Layer.ModuleFile],
    other: NONE,
  },
  [Layer.Effects]: {
    name: 'effects',
    allowed: "lib, services contracts, own state, other modules' index.ts",
    anywhere: [Layer.Lib, Layer.Contract],
    own: [Layer.State, Layer.ModuleFile],
    other: [Layer.Index],
  },
  [Layer.View]: {
    name: 'view',
    allowed: 'lib, ui, own state',
    anywhere: [Layer.Lib, Layer.Ui],
    own: LOCAL_READS,
    other: NONE,
  },
  [Layer.Index]: {
    name: 'index.ts',
    allowed: 'own module files',
    anywhere: NONE,
    own: MODULE_LAYERS,
    other: NONE,
  },
  // Not in SPEC's table: a file inside a module that is none of its four, such
  // as a component only that module uses. It reads like the view it serves.
  [Layer.ModuleFile]: {
    name: 'a module file',
    allowed: 'lib, ui, own module',
    anywhere: [Layer.Lib, Layer.Ui],
    own: LOCAL_READS,
    other: NONE,
  },
  [Layer.App]: {
    name: 'app.ts',
    allowed: 'everything',
    anywhere: EVERY_LAYER,
    own: NONE,
    other: NONE,
  },
};

const isService = (layer: Layer): boolean => layer === Layer.Service || layer === Layer.Contract;

function sameModule({ from, to }: Crossing): boolean {
  return from.module !== NO_MODULE && from.module === to.module;
}

function otherModule({ from, to }: Crossing): boolean {
  return to.module !== NO_MODULE && from.module !== to.module;
}

/**
 * Two things every module file may name as types, because both are public and
 * a type import is erased: a contract (the app's shared vocabulary), and
 * another module's index.ts (the type of what a module receives as a parameter).
 */
function isPublicType(crossing: Crossing): boolean {
  const { from, to, typeOnly } = crossing;

  if (!typeOnly || !MODULE_LAYERS.includes(from.layer)) return false;

  return to.layer === Layer.Contract || (to.layer === Layer.Index && otherModule(crossing));
}

/** The matrix itself: whether `from` may import `to`. */
function permits(crossing: Crossing): boolean {
  const row = MATRIX[crossing.from.layer];
  const { layer } = crossing.to;

  return (
    isPublicType(crossing) ||
    row.anywhere.includes(layer) ||
    (sameModule(crossing) && row.own.includes(layer)) ||
    (otherModule(crossing) && row.other.includes(layer))
  );
}

/** What to write instead, for an import into another module. */
function fixForOtherModule({ from, to }: Crossing): string {
  const surface = `modules/${to.module}/index.ts`;

  const fixes: Partial<Record<Layer, string>> = {
    [Layer.Effects]: `Import it from ${surface}, the module's only public surface; reaching past it couples you to files the module may change.`,
    [Layer.State]: `State cannot depend on another module. React to it in effects, which may import ${surface}, and call a transition with the result.`,
    [Layer.View]: `A view receives other modules as parameters. Have index.ts pass the instance in rather than importing ${to.path}.`,
  };

  return (
    fixes[from.layer] ??
    `A helper inside a module cannot reach another module. Move this into ${from.module}.effects.ts, which may import ${surface}.`
  );
}

/** What to write instead, for an import into `services/` from a module. */
function fixForService({ to, typeOnly }: Crossing): string {
  if (to.layer === Layer.Contract && !typeOnly) {
    return 'Use `import type` — a contract is shared as types, and the adapter it describes is wired in app.ts.';
  }

  return 'Depend on the contract, not the adapter: `import type` from services/*.contract.ts, and let app.ts pass the adapter in.';
}

/** What to write instead, for an import inside one module that crosses its layers. */
function fixWithinModule({ from, to }: Crossing): string {
  const { module } = from;

  if (to.layer === Layer.Index) {
    return 'index.ts assembles the module and imports its files; importing it back from inside makes a cycle. Import the file you need directly.';
  }

  const fixes: Partial<Record<Layer, string>> = {
    [Layer.View]:
      'Declare the intents the view needs as an interface in this file and receive them as a parameter; the effects object satisfies it structurally.',
    [Layer.State]: `State holds signals and pure transitions. Move this into ${module}.effects.ts, which calls a transition with the result.`,
    [Layer.Effects]: `Effects never render. Hand the result to a transition in ${module}.state.ts and let the view read it.`,
  };

  return (
    fixes[from.layer] ??
    `A helper inside a module may use lib, ui and its own state and views. Move the call into ${module}.effects.ts.`
  );
}

/** The replacement, for every row outside the modules. */
const FIXES_OUTSIDE_MODULES: Partial<Record<Layer, string>> = {
  [Layer.Lib]:
    'lib/ may not know the app. Move this code next to its caller, or pass the value in as a parameter.',
  [Layer.Ui]:
    'ui/ components are stateless and know no modules. Take the value as a parameter from the module that renders it.',
  [Layer.Service]:
    "A service is an adapter and knows no modules. Return the data, and let the module's effects apply it.",
  [Layer.Contract]:
    'A contract describes I/O and knows no modules. Move the shared type into the contract itself.',
  [Layer.Index]:
    "index.ts is the module's public surface and re-exports only its own files. Import this in the module file that needs it.",
};

function fixFor(crossing: Crossing): string {
  const { from, to } = crossing;
  const outside = FIXES_OUTSIDE_MODULES[from.layer];

  if (outside !== undefined) return outside;

  if (isService(to.layer)) return fixForService(crossing);

  if (otherModule(crossing)) return fixForOtherModule(crossing);

  if (to.layer === Layer.Ui) {
    return 'State and effects have no markup. Render the ui/ component from the view.';
  }

  return fixWithinModule(crossing);
}

/** The matrix's answer for one import: nothing when it is allowed. */
export function judge(crossing: Crossing): Verdict | undefined {
  if (permits(crossing)) return undefined;

  const row = MATRIX[crossing.from.layer];

  return {
    message: `${row.name} cannot import ${crossing.to.path}; allowed: ${row.allowed}.`,
    fix: fixFor(crossing),
  };
}
