// A consumer's view of the package: type-check a file that imports the built
// entry the way an app would, so a broken declaration chain fails the build
// rather than someone's install.

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'dist/dev/index.js');
const directory = await mkdtemp(resolve(tmpdir(), 'sheratan-types-'));

const consumer = `
import { signal, computed, html, each, render, type Accessor, type EachWindow, type Signal } from ${JSON.stringify(entry)};

const count: Signal<number> = signal(0);
const items = signal([{ id: 1, title: 'a' }]);
const doubled = computed(() => count() * 2);

// Reading gives a deeply read-only view, so this must not type-check.
// @ts-expect-error state is immutable (SPEC §5)
items()[0].title = 'changed';

// The window is the caller's measurement, so it has to type-check as one.
const viewport = computed((): EachWindow => ({ start: 0, count: 32, rowHeight: 28 }));
const row = (item: Accessor<{ readonly title: string }>) => html\`<li>\${computed(() => item().title)}</li>\`;

const view = () => html\`<p>\${doubled}</p><ul>\${each(items, row)}\${each(items, row, viewport)}</ul>\`;

export const stop = render(view, document.body);
`;

const config = {
  compilerOptions: {
    target: 'es2022',
    lib: ['es2023', 'esnext.disposable', 'dom'],
    module: 'nodenext',
    moduleResolution: 'nodenext',
    strict: true,
    noEmit: true,
    types: [],
  },
  files: ['consumer.ts'],
};

await writeFile(resolve(directory, 'consumer.ts'), consumer);
await writeFile(resolve(directory, 'tsconfig.json'), JSON.stringify(config, null, 2));

execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', resolve(directory, 'tsconfig.json')], {
  stdio: 'inherit',
});

process.stdout.write('consumer types resolve\n');
