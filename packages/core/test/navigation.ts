// A stand-in for the Navigation API, which happy-dom does not implement.
// It is deliberately thin: it records what was intercepted and lets a test
// drive one navigation at a time, so the tests are about the router's
// decisions rather than about a simulated browser.

import { forgetLocation, forgetRoutes } from '../src/internal.ts';

/** What a test varies about one navigation. */
export interface Move {
  readonly url: string;
  readonly canIntercept?: boolean;
  readonly hashChange?: boolean;
  /** The `download` attribute's filename, which is `''` when it has none. */
  readonly downloadRequest?: string | null;
  readonly formData?: FormData | null;
}

interface Intercepted {
  readonly handler?: () => Promise<void>;
}

/** The fake, plus the switches a test needs to reach. */
export interface FakeNavigation {
  /** Dispatches one navigation and returns whether the router took it over. */
  go(move: Move): Promise<boolean>;
  /** Every URL passed to `navigation.navigate()`, in order. */
  readonly pushed: readonly string[];
  readonly replaced: readonly string[];
  /** How many `navigate` listeners are attached right now. */
  listeners(): number;
}

const START = 'https://app.test/';

/**
 * Points `globalThis.location` at `href` and installs a fresh fake, forgetting
 * whatever the last test registered. Returns the fake.
 */
export function pageAt(href: string = START): FakeNavigation {
  forgetRoutes();
  forgetLocation();

  const pushed: string[] = [];
  const replaced: string[] = [];
  const listening = new Set<(event: NavigateEvent) => void>();

  let current = href;

  globalThis.location = { href: current } as unknown as Location;

  const fake = {
    addEventListener: (_: string, fn: (event: NavigateEvent) => void): void => {
      listening.add(fn);
    },
    removeEventListener: (_: string, fn: (event: NavigateEvent) => void): void => {
      listening.delete(fn);
    },
    navigate: (to: string, options: { history?: string }): void => {
      const absolute = new URL(to, current).href;

      if (options.history === 'replace') replaced.push(absolute);
      else pushed.push(absolute);
    },
  };

  globalThis.navigation = fake as unknown as Navigation;

  return {
    pushed,
    replaced,
    listeners: (): number => listening.size,
    go: async (move: Move): Promise<boolean> => {
      let taken: Intercepted | undefined;

      const event = {
        canIntercept: move.canIntercept ?? true,
        hashChange: move.hashChange ?? false,
        downloadRequest: move.downloadRequest ?? null,
        formData: move.formData ?? null,
        destination: { url: new URL(move.url, current).href },
        intercept: (options: Intercepted): void => {
          taken = options;
        },
      };

      for (const listener of listening) listener(event as unknown as NavigateEvent);

      if (taken === undefined) return false;

      current = event.destination.url;
      globalThis.location = { href: current } as unknown as Location;

      await taken.handler?.();

      return true;
    },
  };
}

/** Takes the Navigation API away, as a browser below the floor would. */
export function pageWithoutNavigationApi(href: string = START): { readonly visited: string[] } {
  forgetRoutes();
  forgetLocation();

  const visited: string[] = [];

  globalThis.navigation = undefined as unknown as Navigation;

  globalThis.location = {
    href,
    assign: (to: string): void => {
      visited.push(`assign ${to}`);
    },
    replace: (to: string): void => {
      visited.push(`replace ${to}`);
    },
  } as unknown as Location;

  return { visited };
}
