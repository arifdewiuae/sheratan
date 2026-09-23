// The URL as an input effect (SPEC §9b): read as a source, written as an
// effect. The signal is built on first read rather than at module scope,
// because nothing in the runtime may touch the page while it is being
// constructed (SPEC §13, the SSR door).

import { signal } from './signal.ts';
import type { Signal } from './types.ts';

/** The current URL, as the parts a route or a view actually reads. */
export interface Location {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

/** Where {@link navigate} sends the browser, and how it records the move. */
export interface NavigateOptions {
  /** Replaces the current entry instead of pushing one, so Back skips it. */
  readonly replace?: boolean;
  /** Carried on the history entry and restored when it is traversed back to. */
  readonly state?: unknown;
}

/**
 * Strings only, deliberately: a signal freezes what it stores, and a `URL` is
 * not opaque to `DeepReadonly`, so storing one would hand out a mapped copy.
 */
function partsOf(href: string): Location {
  const url = new URL(href);

  return { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash };
}

/**
 * The Navigation API, or nothing. `lib.dom` declares `navigation` as always
 * there, which is only true above the browser floor it became Baseline at, so
 * the type is narrowed back to what a runtime check can actually find.
 */
export function navigationApi(): Navigation | undefined {
  return (globalThis as { navigation?: Navigation }).navigation;
}

let current: Signal<Location> | undefined;

function source(): Signal<Location> {
  current ??= signal(partsOf(globalThis.location.href));

  return current;
}

/**
 * The current URL, as a signal. Reading it in a view is how a link marks
 * itself active; changing it is what `navigate()` is for.
 *
 * @example
 * const active = computed(() => location().pathname === '/orders');
 */
export function location(): Location {
  return source()();
}

/**
 * Records a move the router intercepted. A no-op when the URL is unchanged,
 * because `partsOf` builds a new object every time and every write would
 * otherwise look like a change.
 */
export function moveTo(href: string): void {
  const at = source();
  const next = partsOf(href);

  if (at().href !== next.href) at.set(next);
}

/** Forgets the URL, so a test can start from a different page. */
export function forgetLocation(): void {
  current = undefined;
}

/**
 * Goes to `to`. Legal in `*.effects.ts` only (`SHR-L004`): a view emits the
 * intent and effects carries it out.
 *
 * Without the Navigation API this is an ordinary document load, which is what
 * the link the user did not click would have done.
 *
 * @example
 * const intents = { open: (id: string) => { navigate(`/orders/${id}`); } };
 */
export function navigate(to: string, options?: NavigateOptions): void {
  const replace = options?.replace === true;
  const navigation = navigationApi();

  if (navigation === undefined) {
    if (replace) globalThis.location.replace(to);
    else globalThis.location.assign(to);

    return;
  }

  const history = replace ? 'replace' : 'push';

  navigation.navigate(
    to,
    options?.state === undefined ? { history } : { history, state: options.state },
  );
}
