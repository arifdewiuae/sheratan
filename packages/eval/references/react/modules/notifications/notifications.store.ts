// Client state: the one message the screen is showing, if any. No I/O, no DOM,
// and no knowledge that a component exists.

import { create } from 'zustand';

/** No message, which is also how the store starts. */
export const NOTHING = '';

/** The toast T04 asks for: one message at a time, or none. */
export interface NotificationsStore {
  readonly message: string;
  readonly raised: (message: string) => void;
  readonly dismissed: () => void;
}

/**
 * The store. One per application, read with a selector so a component
 * re-renders only when the slice it asked for changes.
 *
 * @example
 * const message = useNotifications((state) => state.message);
 */
export const useNotifications = create<NotificationsStore>()((set) => ({
  message: NOTHING,

  raised: (message) => set({ message }),

  dismissed: () => set({ message: NOTHING }),
}));

/**
 * Raising a message from outside a component, which is what a mutation's
 * `onError` does. Zustand stores are usable without a hook, and a rollback
 * handler is not a render.
 *
 * @example
 * raise('That order has already left the warehouse.');
 */
export function raise(message: string): void {
  useNotifications.getState().raised(message);
}
