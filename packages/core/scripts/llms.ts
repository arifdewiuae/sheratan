// llms.txt is what an agent learns the API from, so it is generated from the
// declarations the package ships. A doc comment and the table cannot drift.
//
//   node scripts/llms.ts           rewrite the generated section
//   node scripts/llms.ts --check   fail if the section is stale (CI)

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const declarations = resolve(root, 'dist/dev');
const target = resolve(root, '../../llms.txt');

const START = '<!-- generated from TSDoc by packages/core/scripts/llms.ts -->';
const END = '<!-- end generated -->';

/** The order an app meets them in, not alphabetical. */
const ORDER = [
  'signal',
  'computed',
  'watch',
  'batch',
  'resource',
  'onDispose',
  'flush',
  'html',
  'each',
  'render',
];

const DECLARATION =
  /\/\*\*(?<doc>(?:(?!\*\/)[\s\S])*)\*\/\s*export declare (?:function|const|class) (?<name>\w+)(?<rest>[^\n]*)/g;

const REEXPORT = /export \{ (?<names>[^}]*) \} from '(?<from>\.\/[\w.-]+)\.js'/g;

interface Entry {
  signature: string;
  summary: string;
}

function summarise(doc: string): string {
  const lines = doc.split('\n').map((line) => line.replace(/^\s*\*/, '').trim());
  const paragraph: string[] = [];

  for (const line of lines) {
    if (line.startsWith('@')) break;
    if (line === '' && paragraph.length > 0) break;
    if (line !== '') paragraph.push(line);
  }

  return paragraph.join(' ').replace(/\s+/g, ' ');
}

function signatureOf(name: string, rest: string): string {
  return `${name}${rest.replace(/;\s*$/, '').trim()}`;
}

async function entriesOf(file: string): Promise<Map<string, Entry>> {
  const source = await readFile(resolve(declarations, `${file}.d.ts`), 'utf8');
  const entries = new Map<string, Entry>();

  for (const match of source.matchAll(DECLARATION)) {
    const { doc = '', name = '', rest = '' } = match.groups ?? {};

    entries.set(name, { signature: signatureOf(name, rest), summary: summarise(doc) });
  }

  return entries;
}

async function collect(): Promise<Map<string, Entry>> {
  const index = await readFile(resolve(declarations, 'index.d.ts'), 'utf8');

  const reexports = [...index.matchAll(REEXPORT)].map((match) => {
    const { names = '', from = '' } = match.groups ?? {};

    return { names: names.split(',').map((part) => part.trim()), file: from.slice('./'.length) };
  });

  const modules = await Promise.all(reexports.map(async ({ file }) => entriesOf(file)));
  const all = new Map<string, Entry>();

  for (const [position, { names }] of reexports.entries()) {
    const entries = modules[position] as Map<string, Entry>;

    for (const name of names) {
      const entry = entries.get(name);

      if (entry !== undefined) all.set(name, entry);
    }
  }

  return all;
}

function render(entries: Map<string, Entry>): string {
  const missing = ORDER.filter((name) => !entries.has(name));

  if (missing.length > 0) {
    throw new Error(`llms.txt: no declaration found for ${missing.join(', ')}`);
  }

  const rows = ORDER.map((name) => {
    const entry = entries.get(name) as Entry;
    const signature = entry.signature.replaceAll('|', '\\|');

    return `| \`${signature}\` | ${entry.summary} |`;
  });

  return [START, '', '| API | Meaning |', '|---|---|', ...rows, '', END].join('\n');
}

const section = render(await collect());
const current = await readFile(target, 'utf8');
const start = current.indexOf(START);
const end = current.indexOf(END);

if (start === -1 || end === -1) {
  throw new Error(`llms.txt: missing the generated markers (${START})`);
}

const next = current.slice(0, start) + section + current.slice(end + END.length);

if (process.argv.includes('--check')) {
  if (next !== current) {
    process.stderr.write('llms.txt is stale: run `pnpm --filter sheratan llms`\n');
    process.exit(1);
  }

  process.stdout.write('llms.txt matches the declarations\n');
} else {
  await writeFile(target, next);
  process.stdout.write('llms.txt API section written\n');
}
