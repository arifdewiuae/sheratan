import assert from 'node:assert/strict';
import { test } from 'node:test';

import { docsFor, RuleCode, Severity } from '../../check/src/finding.ts';
import { DOCS_BASE_URL, ErrorCode } from '../../core/src/codes.ts';
import {
  escapeHtml,
  indexPage,
  pageFor,
  pathFor,
  prose,
  sitemapSection,
  SITEMAP_END,
  SITEMAP_START,
  staleness,
  withSitemapSection,
} from '../scripts/error-page.ts';
import { explanations, RESERVED } from '../src/explain/explain.ts';
import { CaughtBy, type Explanation } from '../src/explain/explanation.ts';

const HOSTILE: Explanation = {
  code: 'SHR-L001',
  docs: 'https://sheratan.dev/errors/SHR-L001',
  severity: Severity.Error,
  caughtBy: CaughtBy.Checker,
  title: 'A `<b>` in a title',
  why: 'Text with "quotes" & <i>tags</i>.',
  wrong: { 'app.ts': '</code></pre><script>alert(1)</script>\n' },
  right: { 'app.ts': "const ok = '<ok>';\n" },
};

test('every explained code gets a page with its own wrong and right sources', () => {
  for (const entry of explanations()) {
    const page = pageFor(entry);

    assert.match(page, new RegExp(`<span class="code">${entry.code}</span>`));

    for (const source of [...Object.values(entry.wrong), ...Object.values(entry.right)]) {
      assert.ok(page.includes(escapeHtml(source.trimEnd())), `${entry.code} is missing an example`);
    }
  }
});

test('the URL every shipped error prints lands on a generated page', () => {
  const generated = new Set(explanations().map((entry) => pathFor(entry.code)));

  const printed = [
    ...Object.values(RuleCode).map(docsFor),
    ...Object.values(ErrorCode).map((code) => DOCS_BASE_URL + code),
  ];

  for (const url of printed) {
    // Printed without the trailing slash; Pages answers that with a redirect to the directory.
    assert.ok(generated.has(`${new URL(url).pathname}/`), `${url} has no page`);
  }
});

test('an example is shown as text, never run as markup', () => {
  const page = pageFor(HOSTILE);

  assert.ok(!page.includes('<script'), 'a <script> in an example reached the page');
  assert.ok(page.includes('&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;'));
  assert.ok(page.includes('&#39;&lt;ok&gt;&#39;'));
  assert.ok(page.includes('Text with &quot;quotes&quot; &amp; &lt;i&gt;tags&lt;/i&gt;.'));
});

test('backticks in prose become code, and what is inside them is escaped too', () => {
  assert.equal(prose('A `<b>` in a title'), 'A <code>&lt;b&gt;</code> in a title');
  assert.equal(prose('no code here'), 'no code here');
});

test('pages carry a policy with no script source, and no script', () => {
  for (const page of [pageFor(HOSTILE), indexPage(explanations(), RESERVED)]) {
    assert.match(page, /http-equiv="Content-Security-Policy" content="default-src 'none';/);
    assert.doesNotMatch(page, /script-src/);
    assert.doesNotMatch(page, /<script/);
  }
});

test('a checker code and a runtime code say what happens to the wrong example', () => {
  const checker = explanations().find((entry) => entry.caughtBy === CaughtBy.Checker);
  const runtime = explanations().find((entry) => entry.caughtBy === CaughtBy.Runtime);

  assert.ok(checker && runtime);
  assert.match(pageFor(checker), new RegExp(`<code>sheratan check</code> reports ${checker.code}`));
  assert.match(pageFor(runtime), new RegExp(`Throws ${runtime.code}`));
});

test('the index links every code and names the reserved ones', () => {
  const page = indexPage(explanations(), RESERVED);

  for (const entry of explanations()) {
    assert.ok(page.includes(`href="${pathFor(entry.code)}"`), entry.code);
  }

  for (const code of RESERVED) {
    assert.ok(page.includes(`<code>${code}</code>`), code);
  }
});

test('the sitemap gets the index and every page, between its markers and nowhere else', () => {
  const before = `<urlset>\n  <url><loc>https://sheratan.dev/</loc></url>\n  ${SITEMAP_START}\n  old\n  ${SITEMAP_END}\n</urlset>\n`;
  const section = sitemapSection(explanations());
  const after = withSitemapSection(before, section);

  assert.ok(after.includes('<loc>https://sheratan.dev/errors/</loc>'));
  assert.ok(after.includes('<loc>https://sheratan.dev/errors/SHR-L001/</loc>'));
  assert.ok(after.startsWith('<urlset>\n  <url><loc>https://sheratan.dev/</loc></url>'));
  assert.doesNotMatch(after, /old/);
  assert.equal(withSitemapSection(after, section), after);
  assert.throws(() => withSitemapSection('<urlset></urlset>', section), /needs the lines/);
});

test('staleness names a missing page, a stale one and one no code generates', () => {
  const expected = new Map([
    ['errors/SHR-L001/index.html', 'one'],
    ['errors/SHR-L002/index.html', 'two'],
  ]);

  const actual = new Map([
    ['errors/SHR-L002/index.html', 'old'],
    ['errors/SHR-L999/index.html', 'gone'],
  ]);

  assert.deepEqual(staleness(expected, actual), [
    'errors/SHR-L001/index.html is missing',
    'errors/SHR-L002/index.html is stale',
    'errors/SHR-L999/index.html is not generated from any code; remove it',
  ]);

  assert.deepEqual(staleness(expected, expected), []);
});
