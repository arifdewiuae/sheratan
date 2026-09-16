// State: signals and pure transitions. No I/O, no DOM (SPEC §4).

import { computed, signal, type Accessor } from 'sheratan';

/** The toast T04 asks for: one message at a time, or none. */
export interface NotificationsState {
  readonly message: Accessor<string>;
  readonly showing: Accessor<boolean>;

  raised(message: string): void;
  dismissed(): void;
}

const NOTHING = '';

/** Builds the module's state. Called once per mount, inside the mount's scope. */
export function createNotificationsState(): NotificationsState {
  const message = signal(NOTHING);

  return {
    message,
    showing: computed(() => message() !== NOTHING),

    raised(next: string): void {
      message.set(next);
    },

    dismissed(): void {
      message.set(NOTHING);
    },
  };
}
