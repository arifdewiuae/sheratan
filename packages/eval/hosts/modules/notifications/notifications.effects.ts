// Effects: sequencing only. It owns the clock and calls one transition (SPEC §4).

import { onDispose } from 'sheratan';

import type { NotificationsState } from './notifications.state.ts';

/** How long a toast stays up before it takes itself away. */
const LINGER_MS = 4000;

/** What this module can do. The view declares the same shape for itself. */
export interface NotificationsEffects {
  raise(this: void, message: string): void;
  dismiss(this: void): void;
}

/** Wires the state to the host's timer, and gives the mount its teardown. */
export function createNotificationsEffects(state: NotificationsState): NotificationsEffects {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer);

    timer = undefined;
  };

  onDispose(clear);

  return {
    raise(message: string): void {
      clear();
      state.raised(message);

      timer = setTimeout(() => {
        state.dismissed();
      }, LINGER_MS);
    },

    dismiss(): void {
      clear();
      state.dismissed();
    },
  };
}
