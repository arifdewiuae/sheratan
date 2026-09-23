// The only module that imports `typescript/unstable/*` (ADR 0005). The API is
// named unstable and means it, so every call into it lives here: when a
// TypeScript minor reshapes it, this file breaks and no rule does. What it
// hands out is plain data — paths, positions, booleans — never a node, symbol
// or type, so no rule can come to depend on the API's own shapes.

import {
  SyntaxKind,
  type ExportDeclaration,
  type Identifier,
  type ImportDeclaration,
  type Node,
  type SourceFile,
  type StringLiteral,
} from 'typescript/unstable/ast';
import {
  isCallExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
  isPropertyAccessExpression,
  isShorthandPropertyAssignment,
  isTypeQueryNode,
} from 'typescript/unstable/ast/is';
import { skipTrivia } from 'typescript/unstable/ast/scanner';
import {
  API,
  SignatureKind,
  SymbolFlags,
  type Checker,
  type NodeHandle,
  type Signature,
  type Project,
  type Symbol as TsSymbol,
  type Type,
} from 'typescript/unstable/sync';

import type { Position } from './finding.ts';

/** One method a service contract declares (SPEC §5b). */
export interface ContractMethod {
  /** The type that declares it, as a message names it: `FeedApi`. */
  readonly owner: string;
  readonly name: string;
  /** Where it is declared, which is not always the contract that exports it. */
  readonly file: string;
  readonly at: Position;
  /** The return type, printed, so a message can quote it. */
  readonly returns: string;
  /** Whether the caller awaits it: the return type has a callable `then`. */
  readonly awaited: boolean;
  /** Each parameter's type, printed, followed by the types of its own members. */
  readonly takes: readonly string[];
}

/** One import or re-export, resolved. */
export interface ImportEdge {
  /** As written: `./orders.state.ts`, `sheratan`. */
  readonly specifier: string;
  /** The absolute path it resolves to, or nothing when it resolves to nothing. */
  readonly target: string | undefined;
  /** Erased at run time: `import type`, or every named binding marked `type`. */
  readonly typeOnly: boolean;
  readonly at: Position;
}

/** Something a module hands out, and whether a caller could write through it. */
export interface SurfaceMember {
  readonly name: string;
  /** Callable, with a callable `set`: the shape of a `Signal`. */
  readonly writable: boolean;
  /** The type as TypeScript prints it, for messages: `Signal<string>`. */
  readonly printed: string;
  /** Absolute path of the declaration, which may be another file. */
  readonly file: string;
  readonly at: Position;
}

/** A use of a global the platform declares, such as `fetch` or `document`. */
export interface GlobalUse {
  readonly name: string;
  readonly at: Position;
}

/** A call to a value the file imported, named as the module it came from names it. */
export interface CallUse {
  /** The exported name, not the local alias: `import { stream as s }` reports `stream`. */
  readonly name: string;
  /** The specifier it was imported from, exactly as written. */
  readonly from: string;
  readonly at: Position;
}

/** A type-checked program, queried in the terms the rules think in. */
export interface Program extends Disposable {
  /** Every source file of the project: no libraries, no declaration files. */
  readonly files: readonly string[];
  /** Imports and `export … from` re-exports, in source order. */
  importsOf(file: string): readonly ImportEdge[];
  /**
   * What a module hands out: each exported value, and each member of the
   * object an exported function returns — which is where a state factory's
   * surface is (SPEC §4).
   */
  surfaceOf(file: string): readonly SurfaceMember[];
  /**
   * Every value reference to a global declared only in a declaration file —
   * the DOM, the language, `@types/*` — that no local name shadows, in
   * source order. A member name (`window.fetch`'s `fetch`) is not a reference
   * to the global of that name, and neither is a type query (`typeof window`).
   */
  globalsOf(file: string): readonly GlobalUse[];
  /**
   * The methods of every type a file exports: each declared interface and type
   * alias, and the call signatures its members have.
   */
  methodsOf(file: string): readonly ContractMethod[];
  /**
   * Every call to something the file imported, in source order. A local of the
   * same name shadowing the import is not one of these, and neither is a call
   * to a local function that happens to share a name with an export.
   */
  callsOf(file: string): readonly CallUse[];
}

const DECLARATION_FILE = '.d.ts';

/** The first character of a file, for something that has no declaration of its own. */
const FILE_START: Position = { line: 1, column: 1 };

/** Where something is declared. */
interface Location {
  readonly file: string;
  readonly at: Position;
}

/** Where a node starts once its leading comments and whitespace are skipped. */
function positionIn(source: SourceFile, node: Node): Position {
  const { line, character } = source.getLineAndCharacterOfPosition(
    skipTrivia(source.text, node.pos),
  );

  return { line: line + 1, column: character + 1 };
}

function importIsTypeOnly(node: ImportDeclaration): boolean {
  const clause = node.importClause;

  if (clause === undefined) return false;

  if (clause.phaseModifier === SyntaxKind.TypeKeyword) return true;

  if (clause.name !== undefined) return false;

  const bindings = clause.namedBindings;

  return (
    bindings !== undefined &&
    isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function exportIsTypeOnly(node: ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;

  const clause = node.exportClause;

  return (
    clause !== undefined &&
    isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  );
}

/** An identifier that reads a value by its own name, rather than naming a member or a type. */
function isValueReference(node: Identifier): boolean {
  const { parent } = node;

  return !(isPropertyAccessExpression(parent) && parent.name === node) && !isTypeQueryNode(parent);
}

function referencesIn(source: SourceFile): Identifier[] {
  const found: Identifier[] = [];

  const visit = (node: Node): void => {
    if (isIdentifier(node) && isValueReference(node)) found.push(node);

    node.forEachChild(visit);
  };

  source.forEachChild(visit);

  return found;
}

/** What a local name was imported as, and from where. */
interface Imported {
  readonly name: string;
  readonly from: string;
}

/** The value bindings one import statement introduces, local name first. */
function bindingsOf(statement: ImportDeclaration): [string, Imported][] {
  const bindings = statement.importClause?.namedBindings;

  if (bindings === undefined || !isNamedImports(bindings)) return [];

  // The grammar allows nothing but a string literal here.
  const from = (statement.moduleSpecifier as StringLiteral).text;

  return bindings.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => [
      element.name.text,
      { name: (element.propertyName ?? element.name).text, from },
    ]);
}

/** Local name to the export it names, for every value import in the file. */
function valueImportsIn(source: SourceFile): Map<string, Imported> {
  return new Map(
    source.statements.flatMap((statement) =>
      isImportDeclaration(statement) && !importIsTypeOnly(statement) ? bindingsOf(statement) : [],
    ),
  );
}

/** Every identifier in callee position, which is the only place a call names. */
function calleesIn(source: SourceFile): Identifier[] {
  const found: Identifier[] = [];

  const visit = (node: Node): void => {
    if (isCallExpression(node) && isIdentifier(node.expression)) found.push(node.expression);

    node.forEachChild(visit);
  };

  source.forEachChild(visit);

  return found;
}

/**
 * Declared by the platform rather than the project: only in declaration files.
 * An import is declared in the file that imports it, so a package's `fetch`
 * is not the global one; `globalThis` has no declaration at all.
 */
function isAmbientGlobal(symbol: TsSymbol): boolean {
  return symbol.declarations.every((declaration) => declaration.path.endsWith(DECLARATION_FILE));
}

function isWritable(checker: Checker, type: Type): boolean {
  if (checker.getSignaturesOfType(type, SignatureKind.Call).length === 0) return false;

  const set = checker.getPropertyOfType(type, 'set');

  // A property always has a type; only a symbol that is not a value can lack one.
  return (
    set !== undefined &&
    checker.getSignaturesOfType(checker.getTypeOfSymbol(set) as Type, SignatureKind.Call).length > 0
  );
}

/** What a method needs to know about the type that declares it. */
interface MethodContext {
  readonly owner: string;
  /** Where to report a member with no declaration of its own. */
  readonly fallback: Location;
}

/** What a value you can await has, and nothing else does. */
const THEN = 'then';

/** A type the caller awaits: a promise, or anything shaped like one. */
function isThenable(checker: Checker, type: Type): boolean {
  const then = checker.getPropertyOfType(type, THEN);

  if (then === undefined) return false;

  const declared = checker.getTypeOfSymbol(then) as Type;

  return checker.getSignaturesOfType(declared, SignatureKind.Call).length > 0;
}

/** A symbol that declares a type — an interface or a type alias — rather than a value. */
function isDeclaredType(symbol: TsSymbol): boolean {
  return (symbol.flags & (SymbolFlags.Interface | SymbolFlags.TypeAlias)) !== 0;
}

class TypeScriptProgram implements Program {
  readonly files: readonly string[];

  private readonly api: API;

  private readonly project: Project;

  constructor(api: API, project: Project) {
    this.api = api;
    this.project = project;

    this.files = project.program
      .getSourceFileNames()
      .filter((name) => !name.endsWith(DECLARATION_FILE))
      .filter((name) => !project.program.isSourceFileFromExternalLibrary(this.sourceFile(name)));
  }

  importsOf(file: string): readonly ImportEdge[] {
    const source = this.sourceFile(file);
    const edges: ImportEdge[] = [];

    for (const statement of source.statements) {
      if (isImportDeclaration(statement)) {
        edges.push(
          this.edge(
            statement.moduleSpecifier,
            importIsTypeOnly(statement),
            positionIn(source, statement),
          ),
        );
      } else if (isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
        edges.push(
          this.edge(
            statement.moduleSpecifier,
            exportIsTypeOnly(statement),
            positionIn(source, statement),
          ),
        );
      }
    }

    return edges;
  }

  surfaceOf(file: string): readonly SurfaceMember[] {
    const { checker } = this.project;
    const source = this.sourceFile(file);
    const moduleSymbol = checker.getSymbolAtLocation(source);

    // A file with no import or export is a script, and a script hands out nothing.
    if (moduleSymbol === undefined) return [];

    const fileStart: Location = { file: source.fileName, at: FILE_START };

    return checker
      .getExportsOfModule(moduleSymbol)
      .filter((exported) => (exported.flags & SymbolFlags.Value) !== 0)
      .flatMap((exported) => {
        const own = this.member(exported, fileStart);

        return [own].concat(this.returnedMembers(exported, { file: own.file, at: own.at }));
      });
  }

  globalsOf(file: string): readonly GlobalUse[] {
    const source = this.sourceFile(file);
    const references = referencesIn(source);
    const symbols = this.project.checker.getSymbolAtLocation(references);

    return references.flatMap((reference, index) => {
      const symbol = this.valueSymbol(reference, symbols[index]);

      return symbol !== undefined && isAmbientGlobal(symbol)
        ? [{ name: reference.text, at: positionIn(source, reference) }]
        : [];
    });
  }

  methodsOf(file: string): readonly ContractMethod[] {
    const { checker } = this.project;
    const source = this.sourceFile(file);
    const moduleSymbol = checker.getSymbolAtLocation(source);

    if (moduleSymbol === undefined) return [];

    const fallback: Location = { file: source.fileName, at: FILE_START };

    return checker
      .getExportsOfModule(moduleSymbol)
      .map((exported) => this.declaration(exported))
      .filter((exported) => isDeclaredType(exported))
      .flatMap((exported) => this.methodsOfType(exported, fallback));
  }

  callsOf(file: string): readonly CallUse[] {
    const source = this.sourceFile(file);
    const imported = valueImportsIn(source);

    if (imported.size === 0) return [];

    // One pass: a callee is interesting only if its name was imported, and the
    // import it came from is what names it.
    const calls = calleesIn(source).flatMap((callee) => {
      const origin = imported.get(callee.text);

      return origin === undefined ? [] : [{ callee, origin }];
    });

    const symbols = this.project.checker.getSymbolAtLocation(calls.map((call) => call.callee));

    return calls.flatMap(({ callee, origin }, index) => {
      // An import binding is an alias symbol; a local declared over it is not,
      // so a shadowed name reads as the local it actually calls.
      const aliased = symbols[index]?.flags;

      return aliased !== undefined && (aliased & SymbolFlags.Alias) !== 0
        ? [{ name: origin.name, from: origin.from, at: positionIn(source, callee) }]
        : [];
    });
  }

  [Symbol.dispose](): void {
    this.api.close();
  }

  /** Every name this is called with came from this program, so the file is there. */
  private sourceFile(file: string): SourceFile {
    return this.project.program.getSourceFile(file) as SourceFile;
  }

  /** What an identifier reads: for `{ document }`, the variable, not the new property. */
  private valueSymbol(reference: Identifier, symbol: TsSymbol | undefined): TsSymbol | undefined {
    return isShorthandPropertyAssignment(reference.parent)
      ? this.project.checker.getShorthandAssignmentValueSymbol(reference.parent)
      : symbol;
  }

  private edge(specifier: Node, typeOnly: boolean, at: Position): ImportEdge {
    const target = this.project.checker.getSymbolAtLocation(specifier)?.declarations[0];

    return {
      // The grammar allows nothing but a string literal here.
      specifier: (specifier as StringLiteral).text,
      target: target === undefined ? undefined : this.sourceFile(target.path).fileName,
      typeOnly,
      at,
    };
  }

  /**
   * The members of the object an exported function returns: a state
   * factory's surface. A member with no declaration of its own — one produced
   * by a mapped type — is reported at the factory.
   */
  private returnedMembers(exported: TsSymbol, factory: Location): SurfaceMember[] {
    const { checker } = this.project;
    const [call] = checker.getSignaturesOfType(this.typeOf(exported), SignatureKind.Call);

    if (call === undefined) return [];

    // A signature always has a return type, if only `void`.
    const returned = checker.getReturnTypeOfSignature(call) as Type;

    if (checker.isArrayType(returned) || checker.isTupleType(returned)) return [];

    return checker.getPropertiesOfType(returned).map((property) => this.member(property, factory));
  }

  private member(symbol: TsSymbol, fallback: Location): SurfaceMember {
    const { checker } = this.project;
    const type = this.typeOf(symbol);

    const { file, at } = this.locate(symbol.valueDeclaration) ?? fallback;

    return {
      name: symbol.name,
      writable: isWritable(checker, type),
      printed: checker.typeToString(type),
      file,
      at,
    };
  }

  private locate(declaration: NodeHandle | undefined): Location | undefined {
    if (declaration === undefined) return undefined;

    const source = this.sourceFile(declaration.path);

    // A handle the checker gave out resolves in the project it came from.
    return {
      file: source.fileName,
      at: positionIn(source, declaration.resolve(this.project) as Node),
    };
  }

  /** What an export declares, following `export … from` to the type itself. */
  private declaration(exported: TsSymbol): TsSymbol {
    const { checker } = this.project;

    return (exported.flags & SymbolFlags.Alias) === 0
      ? exported
      : checker.getAliasedSymbol(exported);
  }

  /** Every method the type `exported` declares, one entry per call signature. */
  private methodsOfType(exported: TsSymbol, fallback: Location): ContractMethod[] {
    const { checker } = this.project;
    const declared = checker.getDeclaredTypeOfSymbol(exported);

    return checker
      .getPropertiesOfType(declared)
      .flatMap((property) =>
        checker
          .getSignaturesOfType(this.typeOf(property), SignatureKind.Call)
          .map((signature) => this.method(property, signature, { owner: exported.name, fallback })),
      );
  }

  private method(property: TsSymbol, signature: Signature, context: MethodContext): ContractMethod {
    const { checker } = this.project;
    const returned = checker.getReturnTypeOfSignature(signature) as Type;
    const { file, at } = this.locate(property.valueDeclaration) ?? context.fallback;

    return {
      owner: context.owner,
      name: property.name,
      file,
      at,
      returns: checker.typeToString(returned),
      awaited: isThenable(checker, returned),
      takes: this.parameterTypes(signature),
    };
  }

  /**
   * Each parameter's type and the types of its own members, so an options
   * object shows what it carries without the caller walking types.
   */
  private parameterTypes(signature: Signature): string[] {
    const { checker } = this.project;
    const types: string[] = [];

    for (let index = 0; index < signature.parameters.length; index += 1) {
      const parameter = checker.getParameterType(signature, index) as Type;

      types.push(checker.typeToString(parameter));

      for (const member of checker.getPropertiesOfType(parameter)) {
        types.push(checker.typeToString(this.typeOf(member)));
      }
    }

    return types;
  }

  /** Every value symbol has a type; only a symbol that is not a value can lack one. */
  private typeOf(symbol: TsSymbol): Type {
    return this.project.checker.getTypeOfSymbol(symbol) as Type;
  }
}

/**
 * Opens and type-checks the project a `tsconfig.json` describes. Dispose it —
 * it owns a TypeScript process.
 */
export function openProgram(tsconfig: string): Program {
  const api = new API({ cwd: import.meta.dirname });
  const project = api.updateSnapshot({ openProjects: [tsconfig] }).getProject(tsconfig);

  if (project === undefined) {
    api.close();

    throw new Error(`TypeScript could not open ${tsconfig}`);
  }

  return new TypeScriptProgram(api, project);
}
