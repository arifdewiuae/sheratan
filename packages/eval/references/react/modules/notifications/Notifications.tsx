// The toast T04 asserts on, rendered only while there is something to say.

import { useEffect, type JSX } from 'react';

import { NOTHING, useNotifications } from './notifications.store.ts';

/** How long a toast stays up before it takes itself away. */
const LINGER_MS = 4000;

/**
 * The toast. The timer lives in an effect rather than in the store, so it is
 * cleared when the message changes or the component goes away, and a second
 * refusal cannot be dismissed early by the first one's timer.
 *
 * @example
 * <Notifications />
 */
export function Notifications(): JSX.Element | null {
  const message = useNotifications((state) => state.message);
  const dismissed = useNotifications((state) => state.dismissed);

  useEffect(() => {
    if (message === NOTHING) return;

    const timer = setTimeout(dismissed, LINGER_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [message, dismissed]);

  if (message === NOTHING) return null;

  return (
    <div data-testid="toast" role="status">
      <span>{message}</span>
      <button data-testid="dismiss-toast" type="button" onClick={dismissed}>
        Dismiss
      </button>
    </div>
  );
}
