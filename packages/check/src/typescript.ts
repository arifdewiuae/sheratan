// The only module that imports `typescript/unstable/*` (ADR 0005). The API is
// named unstable and means it, so every call into it lives here: when a
// TypeScript minor reshapes it, this file breaks and no rule does. What it
// hands out is plain data — paths, positions, booleans — never a node, symbol
// or type, so no rule can come to depend on the API's own shapes.

import {
  SyntaxKind,
  type ExportDeclaration,
  type ImportDeclaration,
  type Node,
  type SourceFile,
  type StringLiteral,
} from 'typescript/unstable/ast';
import {
  isExportDeclaration,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
} from 'typescript/unstable/ast/is';
import { skipTrivia } from 'typescript/unstable/ast/scanner';
import {
  API,
  SignatureKind,
  SymbolFlags,
  type Checker,
  type NodeHandle,
  type Project,
  type Symbol as TsSymbol,
  type Type,
} from 'typescript/unstable/sync';

import type { Position } from './finding.ts';

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

function isWritable(checker: Checker, type: Type): boolean {
  if (checker.getSignaturesOfType(type, SignatureKind.Call).length === 0) return false;

  const set = checker.getPropertyOfType(type, 'set');

  // A property always has a type; only a symbol that is not a value can lack one.
  return (
    set !== undefined &&
    checker.getSignaturesOfType(checker.getTypeOfSymbol(set) as Type, SignatureKind.Call).length > 0
  );
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

  [Symbol.dispose](): void {
    this.api.close();
  }

  /** Every name this is called with came from this program, so the file is there. */
  private sourceFile(file: string): SourceFile {
    return this.project.program.getSourceFile(file) as SourceFile;
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
