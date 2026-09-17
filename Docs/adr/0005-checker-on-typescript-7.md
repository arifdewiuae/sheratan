# 0005 — The checker targets TypeScript 7's unstable API

**Status:** accepted, 2026-09-17. Resolves the TASKS spec gap "Checker on
TypeScript 7", which blocked all of Week 3.

## Context

SPEC §8 builds `sheratan check` on the TypeScript compiler API, as a
devDependency. That was written when TypeScript 6 was the compiler.

The repo now runs **TypeScript 7.0.2**, the native Go compiler, and TS 7 does
not ship the TS 5/6 JavaScript API. Its `package.json` exports are:

```
"."                 → lib/version.cjs      (a version string, nothing else)
"./unstable/sync"   → the API, over IPC to the Go process
"./unstable/async"  → the same, promise-returning
"./unstable/ast/*"  → nodes, factory, scanner, visitor, clone
```

So `import ts from 'typescript'` gets you a version number. Three ways out:

1. **Pin the checker to TypeScript 6's JS API.** Known-stable, and the whole
   API surface anyone has ever written against.
2. **Target `typescript/unstable/*`.** One TypeScript in the repo, but an API
   whose name says it can break.
3. **Parse with a standalone parser** (oxc, swc, the TS 7 scanner alone).
   No IPC, fast, and no type information at all.

The decision could not be made on reputation, because the open question was
factual: how much of a *type checker* does `unstable/sync` actually expose?

## What was measured

A probe against `packages/eval` — 772 files, four modules in the canonical
shape — implementing `SHR-L010` (SPEC §4: a `*.state.ts` exposes no `Signal`),
which is the rule with the most demanding type requirement in the set. It needs
the declared type of every member of a factory's return type.

```ts
import { API } from 'typescript/unstable/sync';
import { skipTrivia } from 'typescript/unstable/ast/scanner';

const api = new API({ cwd: root });
const snapshot = api.updateSnapshot({ openProjects: [tsconfig] });
const { checker, program } = snapshot.getProject(tsconfig)!;

// the module's exports  →  the factory  →  its return type  →  its members
const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(name));
const factory = checker.getExportsOfModule(moduleSymbol).find(isStateFactory);
const [call] = checker.getSignaturesOfType(checker.getTypeOfSymbol(factory), 0);
const surface = checker.getReturnTypeOfSignature(call);

for (const member of checker.getPropertiesOfType(surface)) {
  const printed = checker.typeToString(checker.getTypeOfSymbol(member));
  // → "Accessor<string>" | "Signal<string>" | "() => void"
  const node = member.valueDeclaration.resolve(project);
  const { line, character } = file.getLineAndCharacterOfPosition(
    skipTrivia(file.text, node.pos),   // without this the range lands on trivia
  );
}
```

Result:

| | |
|---|---|
| State surfaces found and type-checked | 4 |
| Violations on the compliant tree | 0 |
| Violations after widening one field `Accessor` → `Signal` | 1, at `notifications.state.ts:7:3` — the declaration, to the character |
| Open a 772-file program | 56 ms |
| Walk every `*.state.ts` and type every member | 7 ms |

The reported range is exactly SPEC §8's `range: { line, column }`, so the
output shape is reachable without a second source-position pass.

What `unstable/sync` exposes, beyond that probe: `getExportsOfModule`,
`getTypeOfSymbol`, `getDeclaredTypeOfSymbol`, `getTypeAtLocation`,
`getPropertiesOfType`, `getTypeArguments`, `getSignaturesOfType`,
`isTypeAssignableTo`, `getBaseTypes`, `getAliasedSymbol`, `typeToString`, plus
the AST, a scanner and a visitor. That covers every rule in SPEC §4, including
the two that need types rather than syntax: `SHR-L010` and `SHR-L007`
(a `Promise`-returning contract method must take an `AbortSignal`).

## Decision

**Target `typescript/unstable/*`.** `packages/check` imports
`typescript/unstable/sync` for the program and checker, and
`typescript/unstable/ast/*` for syntax-only rules, with `typescript` as a peer
dependency pinned to an exact minor.

Option 1 is rejected on a cost the repo has already paid once: TypeScript 6
only comes back as a *second* TypeScript, which is exactly what leaving
typescript-eslint removed. Two compilers means two versions of the truth about
one codebase, and a checker that disagrees with `pnpm typecheck` is worse than
no checker.

Option 3 is rejected because it cannot express the rules that matter most.
`SHR-L010` is the compile-time half of the L005 guarantee (SPEC §13), and
without types there is no way to tell `Accessor<string>` from `Signal<string>`
— they are both identifiers followed by a type argument. A checker that can
only see syntax would fall back to naming conventions, which is what the Week 0
eval showed already carries `L001` and `L002` on its own
(`Docs/EVAL-RESULTS.md`). The rules worth having are the ones needing types.

## The trade-off accepted

**The API is called `unstable` and means it.** It can change shape between
TypeScript 7 minors with no deprecation period, and when it does, the checker
breaks rather than degrades.

Three things keep that survivable, and they are the price of the decision:

- **`typescript` is pinned exactly**, as a peer dependency, not a range. A
  consumer on a different minor gets a resolution error, not a silent
  misdiagnosis.
- **The API surface is used through one adapter module**, not scattered through
  the rules. Every `unstable/*` import lives in one file, so a breaking change
  is one file's problem.
- **A failing-case test per rule** (already a Week 3 requirement). A checker
  that stops reporting is indistinguishable from a clean project, which is the
  worst failure mode this tool has; the tests are what make it loud.

**IPC is a real cost, and it is small.** 56 ms to open a program is per-run,
not per-file, and 7 ms to type every member of every state surface says the
per-query round trip is not where the time goes. If `sheratan check --watch`
ever needs better, `unstable/async` exists and the snapshot model is built for
incremental updates (`updateSnapshot({ fileChanges })`).

## What would make us revisit

- TypeScript ships a **stable** API for TS 7. Move to it; the adapter module is
  the only thing that changes.
- The unstable API breaks **more than once** in a minor cycle. At that point the
  cost of tracking it exceeds the cost of a second compiler, and option 1 comes
  back — with the disagreement risk stated in the README rather than hidden.
- A rule set emerges that is entirely syntactic. It will not: `SHR-L010` and
  `SHR-L007` are in the MVP.
