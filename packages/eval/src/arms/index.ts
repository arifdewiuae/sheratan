// Every arm this build knows. Adding one is a file beside this and a line
// here — see the note at the top of `arm.ts` for which stacks earn a place
// and why Vue is not one of them.

import type { Arms } from '../arm.ts';
import { sheratanArm } from './sheratan.ts';

/** The arms, by id. */
export const ARMS: Arms = new Map([[sheratanArm.id, sheratanArm]]);
