// `node evalkit/src/main.ts` — the server on a fixed port, for a task run.
// The only file here that owns a process.

import { startEvalkit } from './server.ts';

const DEFAULT_PORT = 5178;
const RADIX = 10;

const port = Number.parseInt(process.env['EVALKIT_PORT'] ?? String(DEFAULT_PORT), RADIX);
const kit = await startEvalkit({ port });

process.stdout.write(`evalkit listening on ${kit.url}\n`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void kit.close().then(() => process.exit(0));
  });
}
