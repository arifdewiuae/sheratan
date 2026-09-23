// Flat path matching (SPEC §9b): a thin wrapper over the platform's
// `URLPattern`, and nothing else. No match tree, no resolution policy —
// the first pattern in the table that matches wins, which is a rule the
// author can read off their own route table.

import type { Accessor } from './types.ts';

/** The named parts a pattern captured, as strings. */
export type RouteParams = Readonly<Record<string, string>>;

/**
 * Patterns to the screens they show. Written in the order they are tried, and
 * the handler takes its params as an accessor, so a screen that stays matched
 * reads new params instead of being rebuilt.
 */
export type RouteTable<T> = Readonly<Record<string, (params: Accessor<RouteParams>) => T>>;

/** One compiled row of a table. */
export interface Route<T> {
  /** The pattern as written, which is also what identifies the screen. */
  readonly key: string;
  readonly pattern: URLPattern;
  readonly make: (params: Accessor<RouteParams>) => T;
}

/** A pattern that matched, and what it captured. */
export interface Matched<T> {
  readonly route: Route<T>;
  readonly params: RouteParams;
}

/** No pattern captures a group that did not take part in the match. */
function groupsOf(result: URLPatternResult): RouteParams {
  const captured = Object.entries(result.pathname.groups).flatMap(([name, value]) =>
    value === undefined ? [] : [[name, value] as const],
  );

  return Object.fromEntries(captured);
}

/** Compiles a table once, in the order it was written. */
export function compile<T>(table: RouteTable<T>): Route<T>[] {
  return Object.entries(table).map(([key, make]) => ({
    key,
    pattern: new URLPattern({ pathname: key }),
    make,
  }));
}

/** The first route that matches `href`, and what it captured. */
export function matchIn<T>(routes: readonly Route<T>[], href: string): Matched<T> | undefined {
  for (const route of routes) {
    const result = route.pattern.exec(href);

    if (result !== null) return { route, params: groupsOf(result) };
  }

  return undefined;
}
