// Development environment. The production build (scripts/build-prod.ts) swaps
// this module for env.prod.ts, which drops the message table from the bundle.

import type { ErrorCode } from './codes.ts';
import type { MessageArgs } from './messages.ts';
import { MESSAGES } from './messages.ts';

/** True in the development build; the production build constant-folds it away. */
export const DEV: boolean = true;

/** Full text for an error code. */
export function describe<C extends ErrorCode>(code: C, args: MessageArgs[C]): string {
  return MESSAGES[code](...args);
}
