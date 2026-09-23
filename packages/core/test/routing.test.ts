// Routing (SPEC §9b): the URL as a source, one table of patterns to screens,
// and nested tables for a layout. Written against the public API, because
// that is what an app writes. The Navigation API is faked — happy-dom has
// none — so what these tests prove is the router's decisions; e2e proves the
// browser's half.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { freshHost } from './dom.ts';
import { pageAt, pageWithoutNavigationApi } from './navigation.ts';
import {
  computed,
  flush,
  html,
  location,
  mount,
  navigate,
  render,
  routes,
  type Accessor,
  type RouteParams,
  type Template,
} from '../src/index.ts';
import { liveSubscriptions } from '../src/internal.ts';

let host: Element;

beforeEach(() => {
  host = freshHost();
});

const text = (): string => host.textContent.replaceAll(/\s+/g, ' ').trim();

/** A module as its `index.ts` hands it over, recording every construction. */
function screen(name: string, built: string[]): () => Template {
  return () => {
    built.push(name);

    return html`<p>${name}</p>`;
  };
}

test('the matched screen is what the hole shows', async () => {
  const page = pageAt('https://app.test/orders');
  const built: string[] = [];

  const shown = routes({
    '/': () => mount(screen('home', built)),
    '/orders': () => mount(screen('orders', built)),
  });

  render(() => html`<main>${shown}</main>`, host);

  assert.equal(text(), 'orders');

  assert.ok(await page.go({ url: '/' }), 'a registered route is intercepted');
  flush();

  assert.equal(text(), 'home');
  assert.deepEqual(built, ['orders', 'home']);
});

test('nothing matched is nothing shown, and a `*` row is how you say otherwise', async () => {
  const page = pageAt('https://app.test/nowhere');
  const built: string[] = [];

  const bare = routes({ '/': () => mount(screen('home', built)) });

  render(() => html`<main>${bare}</main>`, host);

  assert.equal(text(), '');
  assert.equal(await page.go({ url: '/still-nowhere' }), false, 'no route wants it');

  const caught = pageAt('https://app.test/nowhere');
  const other: string[] = [];

  const withFallback = routes({
    '/': () => mount(screen('home', other)),
    '*': () => mount(screen('not found', other)),
  });

  host = freshHost();
  render(() => html`<main>${withFallback}</main>`, host);

  assert.equal(text(), 'not found');
  assert.ok(await caught.go({ url: '/' }), 'the fallback made every URL ours');
});

test('a screen that stays matched keeps its module and reads new params', async () => {
  const page = pageAt('https://app.test/orders/1');
  const built: string[] = [];

  const shown = routes({
    '/orders/:id': (params: Accessor<RouteParams>) => {
      built.push('order');

      const id = computed(() => {
        const { id: current } = params();

        return current ?? '';
      });

      return mount(() => html`<p>order ${id}</p>`);
    },
  });

  render(() => html`<main>${shown}</main>`, host);

  assert.equal(text(), 'order 1');

  await page.go({ url: '/orders/2' });
  flush();

  assert.equal(text(), 'order 2');
  assert.deepEqual(built, ['order'], 'the module was built once, not once per URL');
});

test('a layout is a screen holding its own table, and it survives moves inside it', async () => {
  const page = pageAt('https://app.test/app/orders');
  const built: string[] = [];

  const shell = (): Template => {
    built.push('shell');

    const inner = routes({
      '/app/orders': () => mount(screen('list', built)),
      '/app/orders/:id': () => mount(screen('detail', built)),
      '*': () => mount(screen('index', built)),
    });

    return html`<section>shell ${inner}</section>`;
  };

  const outer = routes({
    '/app/:rest*': () => mount(shell),
    '*': () => mount(screen('outside', built)),
  });

  render(() => html`<main>${outer}</main>`, host);

  assert.equal(text(), 'shell list');

  await page.go({ url: '/app/orders/7' });
  flush();

  assert.equal(text(), 'shell detail');
  assert.deepEqual(built, ['shell', 'list', 'detail'], 'the shell was not rebuilt');

  await page.go({ url: '/elsewhere' });
  flush();

  assert.equal(text(), 'outside');
});

test('leaving a layout unregisters its table, so its routes stop being ours', async () => {
  const page = pageAt('https://app.test/app');

  const shell = (): Template => {
    const inner = routes({ '/app/orders': () => mount(screen('list', [])) });

    return html`<section>shell ${inner}</section>`;
  };

  // The outer table claims `/app` exactly, so `/app/orders` is wanted by the
  // inner table alone — which is what makes its removal observable.
  const outer = routes({
    '/': () => mount(screen('home', [])),
    '/app': () => mount(shell),
  });

  render(() => html`<main>${outer}</main>`, host);

  assert.ok(await page.go({ url: '/app/orders' }), 'the inner table wants it while mounted');

  await page.go({ url: '/' });
  flush();

  assert.equal(text(), 'home');

  assert.equal(
    await page.go({ url: '/app/orders' }),
    false,
    'and once the shell is gone, nobody does',
  );
});

test('a widget that registers no routes leaves the host app alone', async () => {
  const page = pageAt('https://app.test/host/page');

  render(() => html`<aside>widget</aside>`, host);

  assert.equal(page.listeners(), 0, 'no table, no listener');
  assert.equal(await page.go({ url: '/host/other' }), false, 'the host keeps its own links');
});

test('what the browser should keep doing itself is left alone', async () => {
  const page = pageAt('https://app.test/');

  const shown = routes({ '*': () => mount(screen('any', [])) });

  render(() => html`<main>${shown}</main>`, host);

  assert.equal(await page.go({ url: '/x', canIntercept: false }), false, 'another origin');
  assert.equal(await page.go({ url: '/x', hashChange: true }), false, 'a hash change');
  assert.equal(await page.go({ url: '/x', downloadRequest: 'report.csv' }), false, 'a download');

  assert.equal(
    await page.go({ url: '/x', downloadRequest: '' }),
    false,
    'and a download with no filename of its own, which is a falsy string',
  );

  assert.equal(await page.go({ url: '/x', formData: new FormData() }), false, 'a form post');
  assert.ok(await page.go({ url: '/x' }), 'and an ordinary link is still ours');
});

test('location is the URL as a signal, and a view reads it to mark a link active', async () => {
  const page = pageAt('https://app.test/orders?q=open#top');

  assert.deepEqual(
    { ...location() },
    {
      href: 'https://app.test/orders?q=open#top',
      pathname: '/orders',
      search: '?q=open',
      hash: '#top',
    },
  );

  const shown = routes({ '*': () => mount(screen('any', [])) });
  const active = computed(() => (location().pathname === '/' ? 'home' : 'away'));

  render(() => html`<main>${active} ${shown}</main>`, host);

  assert.equal(text(), 'away any');

  await page.go({ url: '/' });
  flush();

  assert.equal(text(), 'home any');
});

test('a navigation to the URL already shown changes nothing downstream', async () => {
  const page = pageAt('https://app.test/orders/1');
  let reads = 0;

  const shown = routes({
    '/orders/:id': (params: Accessor<RouteParams>) =>
      mount(
        () =>
          html`<p>
            ${computed(() => {
              reads += 1;

              const { id } = params();

              return id ?? '';
            })}
          </p>`,
      ),
  });

  render(() => html`<main>${shown}</main>`, host);
  flush();

  const before = reads;

  assert.ok(await page.go({ url: '/orders/1' }), 'it is still a route we own');
  flush();

  assert.equal(reads, before, 'the same URL is not a change, so nothing recomputed');
});

test('the screen is committed before the navigation settles, not a frame later', async () => {
  const page = pageAt('https://app.test/');

  const shown = routes({
    '/': () => mount(screen('home', [])),
    '/orders': () => mount(screen('orders', [])),
  });

  render(() => html`<main>${shown}</main>`, host);

  await page.go({ url: '/orders' });

  // No flush(): the browser restores scroll and focus when the handler
  // settles, so the DOM has to be the new screen by then.
  assert.equal(text(), 'orders');
});

test('navigate pushes by default and replaces when asked', () => {
  const page = pageAt('https://app.test/');

  navigate('/orders');
  navigate('/orders/1', { replace: true });
  navigate('/orders/2', { state: { from: 'list' } });

  assert.deepEqual(page.pushed, ['https://app.test/orders', 'https://app.test/orders/2']);
  assert.deepEqual(page.replaced, ['https://app.test/orders/1']);
});

test('without the Navigation API a screen still renders and navigate loads the page', () => {
  const page = pageWithoutNavigationApi('https://app.test/orders');
  const built: string[] = [];

  const shown = routes({
    '/': () => mount(screen('home', built)),
    '/orders': () => mount(screen('orders', built)),
  });

  render(() => html`<main>${shown}</main>`, host);

  assert.equal(text(), 'orders', 'the URL still picked the screen');

  navigate('/');
  navigate('/orders', { replace: true });

  assert.deepEqual(page.visited, ['assign /', 'replace /orders'], 'real document loads');
});

test('a mounted and disposed router leaves no subscription behind', () => {
  pageAt('https://app.test/orders');

  const before = liveSubscriptions();

  for (let run = 0; run < 3; run += 1) {
    const shown = routes({
      '/orders': () => mount(screen('orders', [])),
      '*': () => mount(screen('other', [])),
    });

    const stop = render(() => html`<main>${shown}</main>`, host);

    flush();
    stop();
  }

  assert.equal(liveSubscriptions(), before);
});
