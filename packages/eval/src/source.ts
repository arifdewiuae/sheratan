// Reading a source file without being fooled by what is inside a comment or a
// string. Every scan in `detect.ts` runs over the blanked text, so a rule name
// written in a comment is not a violation and a URL in a string is not a call.

/** One file of the tree under inspection. */
export interface SourceFile {
  /** Path relative to the tree root, with forward slashes. */
  readonly path: string;
  readonly text: string;
}

/** Where something is, counted the way an editor counts (SPEC §8). */
export interface Position {
  readonly line: number;
  readonly column: number;
}

const QUOTES = new Set(['"', "'", '`']);
const BLANK = ' ';

/** A backslash and the character it escapes, which is never a closing quote. */
const ESCAPE_LENGTH = 2;

interface Scan {
  readonly text: string;
  out: string[];
  at: number;
}

function skipTo(scan: Scan, end: string, keepLast: boolean): void {
  const found = scan.text.indexOf(end, scan.at);
  const stop = found === -1 ? scan.text.length : found + end.length;

  for (let index = scan.at; index < stop; index++) {
    const character = scan.text[index] as string;

    // Newlines are kept so every position still maps to its own line.
    scan.out.push(character === '\n' ? '\n' : BLANK);
  }

  scan.at = stop;

  if (keepLast) scan.out[scan.out.length - 1] = end;
}

function skipString(scan: Scan, quote: string): void {
  scan.out.push(quote);
  scan.at += 1;

  while (scan.at < scan.text.length) {
    const character = scan.text[scan.at] as string;

    if (character === '\\') {
      scan.out.push(BLANK, BLANK);
      scan.at += ESCAPE_LENGTH;
      continue;
    }

    scan.out.push(character === '\n' ? '\n' : BLANK);
    scan.at += 1;

    if (character === quote) return;
  }
}

/**
 * Replaces the contents of comments and strings with spaces, keeping every
 * other character and every newline where it was. Offsets into the result are
 * offsets into the original.
 */
export function blank(text: string): string {
  const scan: Scan = { text, out: [], at: 0 };

  while (scan.at < text.length) {
    const two = text.slice(scan.at, scan.at + ESCAPE_LENGTH);
    const character = text[scan.at] as string;

    if (two === '//') skipTo(scan, '\n', true);
    else if (two === '/*') skipTo(scan, '*/', false);
    else if (QUOTES.has(character)) skipString(scan, character);
    else {
      scan.out.push(character);
      scan.at += 1;
    }
  }

  return scan.out.join('');
}

/** Turns an offset into the line and column a person would name. */
export function positionOf(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const start = before.lastIndexOf('\n') + 1;

  return { line, column: offset - start + 1 };
}
