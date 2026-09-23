// Where a file sits in the project layout (SPEC §4), which is what the import
// matrix is keyed on. A file outside the layout — a test, a script, anything
// in node_modules — has no place, and no rule speaks about it.

import { basename, isAbsolute, relative, sep } from 'node:path';

/** A row or column of the import matrix. */
export const Layer = {
  Lib: 'lib',
  Ui: 'ui',
  /** A `services/` adapter: the code that actually does I/O. */
  Service: 'service',
  /** A `services/*.contract.ts`: the interface modules depend on. */
  Contract: 'contract',
  State: 'state',
  Effects: 'effects',
  View: 'view',
  Index: 'index',
  /** Anything else inside a module folder, such as a component only that module uses. */
  ModuleFile: 'module file',
  App: 'app',
} as const;

/** One of the layers. */
export type Layer = (typeof Layer)[keyof typeof Layer];

/** A file's layer, and for a module's files, which module. */
export interface Place {
  readonly layer: Layer;
  /** The module a file belongs to, or {@link NO_MODULE} outside `modules/`. */
  readonly module: string;
  /** Relative to the app root, forward slashes: what a finding prints. */
  readonly path: string;
}

/** The module of a file that is not in one. */
export const NO_MODULE = '';

const TEST_FILE = /\.(?:test|spec)\.ts$/;

const APP_FILE = 'app.ts';

/** A module's only public surface, and where its kind is declared (SPEC §4). */
export const INDEX_FILE = 'index.ts';

const CONTRACT_SUFFIX = '.contract.ts';

const SERVICES = 'services';

const MODULES = 'modules';

/** `modules/<name>/<file>`: the depth at which a file is one of a module's own. */
const MODULE_FILE_DEPTH = 3;

/** Top-level folders that are a layer on their own. */
const FOLDERS = new Map<string, Layer>([
  ['lib', Layer.Lib],
  ['ui', Layer.Ui],
]);

/** What a module's own file is called, by the layer it holds (SPEC §4). */
export const SUFFIXES: ReadonlyMap<Layer, string> = new Map([
  [Layer.State, '.state.ts'],
  [Layer.Effects, '.effects.ts'],
  [Layer.View, '.view.ts'],
]);

function moduleLayer(segments: readonly string[], name: string): Layer {
  if (segments.length === MODULE_FILE_DEPTH && name === INDEX_FILE) return Layer.Index;

  for (const [layer, suffix] of SUFFIXES) {
    if (name.endsWith(suffix)) return layer;
  }

  return Layer.ModuleFile;
}

/** A file's layer by the folder it is in, for a path already known to be inside the root. */
function layerOf(path: string): Omit<Place, 'path'> | undefined {
  const segments = path.split('/');
  const [top = ''] = segments;
  const folder = path === APP_FILE ? Layer.App : FOLDERS.get(top);

  if (folder !== undefined) return { layer: folder, module: NO_MODULE };

  if (top === SERVICES) {
    return {
      layer: path.endsWith(CONTRACT_SUFFIX) ? Layer.Contract : Layer.Service,
      module: NO_MODULE,
    };
  }

  if (top !== MODULES || segments.length < MODULE_FILE_DEPTH) return undefined;

  return { layer: moduleLayer(segments, basename(path)), module: segments[1] ?? NO_MODULE };
}

/**
 * `file` as the project prints it — relative to the app root, forward slashes —
 * or nothing when it is outside the root entirely.
 */
export function pathOf(root: string, file: string): string | undefined {
  const path = relative(root, file).split(sep).join('/');

  return path.startsWith('..') || isAbsolute(path) ? undefined : path;
}

/** Where `file` sits under `root`, or nothing when it is outside the layout. */
export function placeOf(root: string, file: string): Place | undefined {
  const path = pathOf(root, file);

  if (path === undefined || TEST_FILE.test(path)) return undefined;

  const place = layerOf(path);

  return place === undefined ? undefined : { ...place, path };
}
