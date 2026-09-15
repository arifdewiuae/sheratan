// Production environment. Errors keep their code and point at the docs, so a
// build carries no message text (SPEC A3: codes are the machine-readable part).

import type { ErrorCode } from './codes.ts';
import { DOCS_BASE_URL } from './codes.ts';
import type { MessageArgs } from './messages.ts';

/** False in the production build, so dev-only branches fold away. */
export const DEV = false;

/** Docs link for an error code. */
export function describe<C extends ErrorCode>(code: C, _args: MessageArgs[C]): string {
  return DOCS_BASE_URL + code;
}
