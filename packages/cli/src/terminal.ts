// What a command may do to the outside world: two streams and one question
// about colour. Everything else in `src/` is a pure function, so the whole CLI
// is testable by calling it and reading back what it wrote.

/** The streams a command writes to, and whether they take colour. */
export interface Terminal {
  /** What the command produces: findings, JSON, help. */
  readonly out: (text: string) => void;
  /** Why the command could not run. Never mixed into `out`, so `--json` stays parseable. */
  readonly err: (text: string) => void;
  /** Whether escape codes reach a human rather than a pipe or a log file. */
  readonly colour: boolean;
}

/** How a command ended, as the process exit code (SPEC §8). */
export const Exit = {
  /** No errors. Warnings do not fail a check. */
  Clean: 0,
  /** At least one error-severity finding. */
  Violations: 1,
  /** The command could not run: bad arguments, or a project that will not open. */
  Usage: 2,
} as const;

/** One of the exit codes. */
export type Exit = (typeof Exit)[keyof typeof Exit];

/** SGR codes, named for what they mark rather than for the colour they are. */
export const Style = {
  Error: '31m',
  Warning: '33m',
  Muted: '2m',
  Strong: '1m',
} as const;

/** One of the styles. */
export type Style = (typeof Style)[keyof typeof Style];

const ESCAPE = '\u001B[';

const RESET = `${ESCAPE}0m`;

/** `text` in `style`, or `text` unchanged where colour is off. */
export function paint(terminal: Terminal, style: Style, text: string): string {
  return terminal.colour ? `${ESCAPE}${style}${text}${RESET}` : text;
}
