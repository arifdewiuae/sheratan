// The one place the runtime throws from (AGENTS.md "Errors").

import type { ErrorCode } from './codes.ts';
import { describe } from './env.ts';
import type { MessageArgs } from './messages.ts';

/** An error thrown by the runtime, identified by a stable `code`. */
export class SheratanError extends Error {
  /** The stable code, e.g. `SHR-R007`. */
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SheratanError';
    this.code = code;
  }
}

/** Throws the error for `code`, with the text its message table defines. */
export function fail<C extends ErrorCode>(code: C, ...args: MessageArgs[C]): never {
  throw new SheratanError(code, describe(code, args));
}
