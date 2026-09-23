// Routing (SPEC §9b). One table of patterns to screens, and one `navigate`
// listener for as long as at least one table is on screen.
//
// The listener intercepts a navigation only when a registered route matches
// it. That is what keeps widget mode honest (SPEC §10d): a widget mounted
// inside somebody else's app registers no routes, so the host's own links are
// never taken over.

import { computed } from './computed.ts';
import { location, moveTo, navigationApi } from './location.ts';
import { compile, matchIn, type Route, type RouteParams, type RouteTable } from './match.ts';
import { getOwner, onDispose } from './owner.ts';
import { flush } from './scheduler.ts';
import type { Accessor } from './types.ts';

/** A screen matched nothing, so it captured nothing either. */
const NO_PARAMS: RouteParams = Object.freeze({});

/** One test per mounted table: does any of its routes want this URL? */
const wanted = new Set<(href: string) => boolean>();

let unlisten: (() => void) | undefined;

function intercepts(href: string): boolean {
  for (const wants of wanted) {
    if (wants(href)) return true;
  }

  return false;
}

function onNavigate(event: NavigateEvent): void {
  // Everything the browser should keep doing itself: another origin, a
  // download, a form post, and a hash change the page may be styling on.
  if (!event.canIntercept || event.hashChange || event.downloadRequest !== null) return;

  if (event.formData !== null) return;

  if (!intercepts(event.destination.url)) return;

  event.intercept({
    // Committing in this frame rather than the next is what lets the browser's
    // own scroll and focus restoration land on the screen that just arrived.
    handler: (): Promise<void> => {
      moveTo(event.destination.url);
      flush();

      return Promise.resolve();
    },
  });
}

/** Starts listening once, for however many tables are mounted. */
function listen(): void {
  const navigation = navigationApi();

  // No Navigation API: nothing is intercepted, so a link is an ordinary
  // document load and every screen still works — one page at a time.
  if (unlisten !== undefined || navigation === undefined) return;

  navigation.addEventListener('navigate', onNavigate);

  unlisten = (): void => {
    navigation.removeEventListener('navigate', onNavigate);
  };
}

function register(compiled: readonly Route<unknown>[]): void {
  const wants = (href: string): boolean => matchIn(compiled, href) !== undefined;

  wanted.add(wants);
  listen();

  // A table registered outside any owner — in `app.ts`, before `render()` —
  // lives as long as the page, which is what an app-level table should do.
  if (getOwner() === undefined) return;

  onDispose(() => {
    wanted.delete(wants);

    if (wanted.size === 0) stop();
  });
}

function stop(): void {
  unlisten?.();
  unlisten = undefined;
}

/**
 * Matches the URL against a flat table and returns the screen it names, or
 * `undefined` when nothing matches — give the table a `'*'` row to say what
 * happens then.
 *
 * A screen is rebuilt when the **pattern** it matched changes, not when the
 * URL does, so `/orders/1` to `/orders/2` keeps the module and hands it new
 * params. Nesting is a screen that holds its own table.
 *
 * @example
 * const screen = routes({
 *   '/':           () => mount(createHome()),
 *   '/orders/:id': (params) => mount(createOrder(api), { id: () => params().id }),
 *   '*':           () => mount(createNotFound()),
 * });
 */
export function routes<T>(table: RouteTable<T>): Accessor<T | undefined> {
  const compiled = compile(table);
  const byKey = new Map(compiled.map((route) => [route.key, route]));

  register(compiled);

  const matched = computed(() => matchIn(compiled, location().href));
  const key = computed(() => matched()?.route.key);
  const params = computed(() => matched()?.params ?? NO_PARAMS);

  // Depends on the key alone, so it re-runs when the screen changes and not
  // when its params do. An unchanged screen is the same object, which stops
  // propagation and leaves the mounted child where it is.
  const screen = computed(() => {
    const route = byKey.get(key() ?? '');

    return route === undefined ? undefined : route.make(params);
  });

  return screen as Accessor<T | undefined>;
}

/** Drops every registered table, so a test can start from an empty page. */
export function forgetRoutes(): void {
  wanted.clear();
  stop();
}
