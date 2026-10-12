// Writes the error index into site/ from `sheratan explain`'s table, so every
// `sheratan.dev/errors/<code>` URL a shipped error prints has a page, and the
// page says what the command says. The pages are committed, like llms.txt:
// the Pages workflow uploads site/ as it is, with no build step.
//
//   node scripts/errors.ts           rewrite site/errors/ and the sitemap's generated part
//   node scripts/errors.ts --check   fail if anything there is missing, stale or orphaned (CI)

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { explanations, RESERVED } from '../src/explain/explain.ts';
import { indexPage, pageFor, sitemapSection, staleness, withSitemapSection } from './error-page.ts';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '../../../site');
const errors = join(site, 'errors');
const SITEMAP = 'sitemap.xml';

/** Every generated file by its path under site/, and what it should hold. */
async function expected(): Promise<Map<string, string>> {
  const all = explanations();
  const files = new Map<string, string>([['errors/index.html', indexPage(all, RESERVED)]]);

  for (const entry of all) files.set(`errors/${entry.code}/index.html`, pageFor(entry));

  const sitemap = await readFile(join(site, SITEMAP), 'utf8');

  files.set(SITEMAP, withSitemapSection(sitemap, sitemapSection(all)));

  return files;
}

/** What is on disk now under site/errors/, plus the sitemap. */
async function actual(): Promise<Map<string, string>> {
  const entries = await readdir(errors, { recursive: true, withFileTypes: true }).catch(() => []);

  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(site, join(entry.parentPath, entry.name)));

  const contents = await Promise.all(
    [...paths, SITEMAP].map(
      async (path) => [path, await readFile(join(site, path), 'utf8')] as const,
    ),
  );

  return new Map(contents);
}

const want = await expected();

if (process.argv.includes('--check')) {
  const problems = staleness(want, await actual());

  if (problems.length > 0) {
    console.error(
      `site/ is out of date with sheratan explain's table:\n  ${problems.join('\n  ')}`,
    );

    console.error('Run `pnpm --filter @sheratan/cli errors` and commit the result.');

    process.exitCode = 1;
  }
} else {
  await rm(errors, { recursive: true, force: true });

  await Promise.all(
    [...want].map(async ([path, content]) => {
      const target = join(site, path);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );

  console.log(`Wrote ${want.size - 1} pages under site/errors/ and the sitemap's generated part.`);
}
