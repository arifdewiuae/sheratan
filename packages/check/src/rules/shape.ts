// SHR-L006 (SPEC §4): a module is a directory whose file set is fixed by the
// kind its `index.ts` declares. Two kinds only — `view` is a view and an
// index, `full` adds state and effects — because a variable file set brings
// back the choice A1 forbids, and a mandatory four produces hollow files
// written to satisfy a checker.
//
// The kind is read as the type of the exported `kind`: `export const kind =
// 'full'` is a literal the compiler already knows, and `kind: string` is not a
// declaration of anything.

import {
  docsFor,
  FILE_START,
  RuleCode,
  Severity,
  type Finding,
  type Position,
} from '../finding.ts';
import { INDEX_FILE, Layer, NO_MODULE, placeOf, SUFFIXES, type Place } from '../layout.ts';
import type { Program, SurfaceMember } from '../typescript.ts';

/** The two kinds a module may declare (SPEC §4). */
const ModuleKind = {
  View: 'view',
  Full: 'full',
} as const;

/** One of the module kinds. */
type ModuleKind = (typeof ModuleKind)[keyof typeof ModuleKind];

/** What each kind is made of, beside `index.ts`. */
const PARTS: Readonly<Record<ModuleKind, readonly Layer[]>> = {
  [ModuleKind.View]: [Layer.View],
  [ModuleKind.Full]: [Layer.State, Layer.Effects, Layer.View],
};

/** The export that declares the kind. */
const KIND = 'kind';

/** What a literal type is printed with, and what a value is not. */
const QUOTE = '"';

/** The extension every module file ends in, dropped when a message names the part. */
const EXTENSION = '.ts';

/** A module's own file, kept beside the path the program knows it by. */
interface Own {
  readonly file: string;
  readonly place: Place;
}

/** One module, once its kind is known: everything a message needs. */
interface Module {
  readonly name: string;
  readonly kind: ModuleKind;
  /** `index.ts`, as a finding prints it. */
  readonly index: string;
  /** Where the kind is declared, which is what a wrong file set points at. */
  readonly at: Position;
  readonly own: readonly Own[];
}

function shapeFinding(
  file: string,
  range: Position,
  text: Pick<Finding, 'message' | 'fix'>,
): Finding {
  return {
    code: RuleCode.Shape,
    severity: Severity.Error,
    file,
    range,
    ...text,
    docs: docsFor(RuleCode.Shape),
  };
}

/** `todo.state.ts`, `todo.view.ts` … — what this module's file for a layer is called. */
function nameOf(module: string, suffix: string): string {
  return `${module}${suffix}`;
}

function fileNameOf(place: Place): string {
  return place.path.slice(place.path.lastIndexOf('/') + 1);
}

/** The kind's file set, spelled out the way its message names it. */
function partsOf(name: string, kind: ModuleKind): string {
  const parts = [...SUFFIXES]
    .filter(([layer]) => PARTS[kind].includes(layer))
    .map(([, suffix]) => nameOf(name, suffix));

  return `${parts.join(', ')} and ${INDEX_FILE}`;
}

function missing(module: Module, suffix: string): Finding {
  const { name, kind, index } = module;
  const wanted = nameOf(name, suffix);

  const alternative =
    kind === ModuleKind.Full
      ? `, or declare kind '${ModuleKind.View}' in ${index} if the module has no state or I/O of its own`
      : '';

  return shapeFinding(index, module.at, {
    message: `modules/${name} declares kind '${kind}' but has no ${wanted}; a ${kind} module is ${partsOf(name, kind)}.`,
    fix: `Add modules/${name}/${wanted}${alternative}.`,
  });
}

function forbidden(module: Module, own: Own): Finding {
  const { name, kind } = module;

  return shapeFinding(own.place.path, FILE_START, {
    message: `modules/${name} declares kind '${kind}' but has ${fileNameOf(own.place)}; a ${kind} module is ${partsOf(name, kind)}.`,
    fix: `Declare kind '${ModuleKind.Full}' in ${module.index} if this module really has state and effects of its own, or move them into the module that owns them.`,
  });
}

function misnamed(module: Module, own: Own, suffix: string): Finding {
  const wanted = nameOf(module.name, suffix);
  const part = suffix.slice(1, -EXTENSION.length);

  return shapeFinding(own.place.path, FILE_START, {
    message: `${own.place.path} carries a module file's suffix under another name; allowed in modules/${module.name}: ${wanted}, and files with no layer suffix.`,
    fix: `Rename it to modules/${module.name}/${wanted} if it is this module's ${part}, or drop the suffix — a component only this module uses is an ordinary file beside it.`,
  });
}

/** What one layer says about the module: a removal, an addition, a rename, or nothing. */
function layerFindings(module: Module, layer: Layer, suffix: string): Finding[] {
  const files = module.own.filter((own) => own.place.layer === layer);

  if (!PARTS[module.kind].includes(layer)) return files.map((own) => forbidden(module, own));

  if (files.length === 0) return [missing(module, suffix)];

  // A file with the right suffix under the wrong name is a rename, and that
  // rename is also what supplies the part. Reporting it missing as well would
  // name one mistake twice.
  const wanted = nameOf(module.name, suffix);

  return files
    .filter((own) => fileNameOf(own.place) !== wanted)
    .map((own) => misnamed(module, own, suffix));
}

function noIndex(name: string, own: readonly Own[]): Finding {
  // The module has at least one file, or nothing would have named it.
  const first = own.reduce((earliest, file) =>
    file.place.path < earliest.place.path ? file : earliest,
  );

  return shapeFinding(first.place.path, FILE_START, {
    message: `modules/${name} has no ${INDEX_FILE}, so nothing declares its kind or its public surface; allowed: ${partsOf(name, ModuleKind.View)}, or ${partsOf(name, ModuleKind.Full)}.`,
    fix: `Add modules/${name}/${INDEX_FILE} with export const kind = '${ModuleKind.View}' (or '${ModuleKind.Full}') and a factory returning the module's view.`,
  });
}

function noKind(name: string, index: Place): Finding {
  return shapeFinding(index.path, FILE_START, {
    message: `${index.path} exports no ${KIND}, so nothing says which files modules/${name} must have; allowed: export const ${KIND} = '${ModuleKind.View}' or '${ModuleKind.Full}'.`,
    fix: `Add export const ${KIND} = '${ModuleKind.Full}' if the module has state and effects of its own, or '${ModuleKind.View}' if it is markup and nothing else.`,
  });
}

function notAKind(index: Place, member: SurfaceMember): Finding {
  return shapeFinding(index.path, member.at, {
    message: `${index.path} declares ${KIND} as ${member.printed}; allowed: the literal '${ModuleKind.View}' or '${ModuleKind.Full}'.`,
    fix: `Write export const ${KIND} = '${ModuleKind.View}' (or '${ModuleKind.Full}') with no type annotation, so the kind is a value the checker and an editor both read.`,
  });
}

/** The kind a module declared, when what it declared is one of the two. */
function kindFrom(printed: string): ModuleKind | undefined {
  const literal = printed.replaceAll(QUOTE, '');

  return Object.values(ModuleKind).find((kind) => kind === literal);
}

function moduleFindings(program: Program, name: string, own: readonly Own[]): Finding[] {
  const index = own.find((file) => file.place.layer === Layer.Index);

  if (index === undefined) return [noIndex(name, own)];

  const member = program.surfaceOf(index.file).find((exported) => exported.name === KIND);

  if (member === undefined) return [noKind(name, index.place)];

  const kind = kindFrom(member.printed);

  if (kind === undefined) return [notAKind(index.place, member)];

  const module: Module = { name, kind, index: index.place.path, at: member.at, own };

  return [...SUFFIXES].flatMap(([layer, suffix]) => layerFindings(module, layer, suffix));
}

/** Every module whose files disagree with the kind it declares. */
export function shape(program: Program, root: string): Finding[] {
  const modules = new Map<string, Own[]>();

  for (const file of program.files) {
    const place = placeOf(root, file);

    if (place === undefined || place.module === NO_MODULE) continue;

    const own = modules.get(place.module) ?? [];

    own.push({ file, place });
    modules.set(place.module, own);
  }

  return [...modules].flatMap(([name, own]) => moduleFindings(program, name, own));
}
