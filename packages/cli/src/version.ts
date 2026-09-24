// What a scaffolded app is told to install. The runtime's version is a fact
// about the published package, and the command is bundled, so it is written
// here once rather than resolved from disk at run time — a path that would
// differ between the source tree and the tarball.
//
// `scripts/verify-cli.ts` fails the build when this disagrees with
// `packages/core/package.json`, which is the only thing that keeps it honest.

/** The published version of the runtime, as `packages/core/package.json` has it. */
export const RUNTIME_VERSION = '0.0.1';
