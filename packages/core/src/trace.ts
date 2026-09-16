// The causal trace (SPEC §7). Every call into this module sits behind `DEV`,
// which the production build folds to `false`, so none of it — not the buffer,
// not the stack capture, not `__sheratan` — reaches a shipped bundle.
//
// The hard part is the gap. A write happens now; the DOM patch it causes runs
// on the next frame, by which time "the current cause" has moved on. So a
// watcher is stamped with the cause when it is queued, and the stamp is read
// back when the scheduler runs it.

import { NodeType } from './dom.ts';

/** Entries kept before the oldest is overwritten (SPEC §7). */
const DEPTH = 500;

/** Writes per second above which only one in `SAMPLE` is recorded. */
const BURST = 1000;

/** How thinly a burst is sampled once it is over `BURST`. */
const SAMPLE = 20;

const SECOND_MS = 1000;

/** Longest rendering of a value kept in an entry. */
const VALUE_CHARS = 32;

/** Keys shown when a value is an object, which is enough to recognise it. */
const KEYS = 3;

const UNKNOWN = 'unknown';

/** A write the runtime made itself, such as `each` rewriting a row's item. */
const INTERNAL = 'sheratan';

/** Where this module's own frames live, so a call site can skip past them. */
const HERE = import.meta.url.slice(0, import.meta.url.lastIndexOf('/'));

/** What happened, in the order a chain puts them. */
export const TraceKind = {
  /** A signal was given a new value. Every chain starts with one. */
  Write: 'write',
  /** A derivation re-ran and its value changed. */
  Compute: 'compute',
  /** The DOM was written. */
  Patch: 'patch',
} as const;

/** One of {@link TraceKind}. */
export type TraceKind = (typeof TraceKind)[keyof typeof TraceKind];

/** One step in a chain. The JSON shape is the contract (SPEC §8). */
export interface TraceEntry {
  /** Milliseconds since recording started. */
  readonly at: number;
  /** The write this step follows from. Steps sharing one are one chain. */
  readonly cause: number;
  readonly kind: TraceKind;
  /** A write's call site; a derivation's id; the element a patch wrote. */
  readonly source: string;
  /** The value before, for a write. */
  readonly from?: string;
  /** The value after, for a write. */
  readonly to?: string;
}

/** What `__sheratan.trace()` returns. */
export interface TraceReport {
  /** The buffer's size, so a full buffer is recognisable. */
  readonly depth: number;
  /** Entries the buffer dropped, plus writes that sampling skipped. */
  readonly dropped: number;
  readonly entries: readonly TraceEntry[];
}

let recording = false;
let started = 0;
let dropped = 0;
let nextCause = 0;
let current = 0;

const buffer: TraceEntry[] = [];
const stamps = new WeakMap<object, number>();
const ids = new WeakMap<object, number>();
let nextId = 0;

/** Writes seen in the current second, for the sampling decision. */
let windowOpened = 0;
let inWindow = 0;

function push(entry: TraceEntry): void {
  buffer.push(entry);

  if (buffer.length > DEPTH) {
    buffer.shift();
    dropped += 1;
  }
}

/**
 * Whether this write is recorded. A flood is the case the trace exists for and
 * the one it must not itself make worse, so past `BURST` writes in a second it
 * keeps one in `SAMPLE` and counts the rest as dropped.
 */
function admits(now: number): boolean {
  if (now - windowOpened >= SECOND_MS) {
    windowOpened = now;
    inWindow = 0;
  }

  inWindow += 1;

  if (inWindow <= BURST) return true;

  dropped += 1;

  return inWindow % SAMPLE === 0;
}

/** A whole path is noise in a trace; the last two segments locate the line. */
function shorten(frame: string): string {
  return frame
    .trim()
    .replace(/^at\s+/, '')
    .replace(/(?:file:\/\/)?\/\S*?([^/]+\/[^/:]+:\d+:\d+)/, '$1');
}

/**
 * The code that wrote: the first frame outside this library. When there is
 * none the write came from the runtime itself — `each` rewriting a row's item
 * is one — and the innermost frame that is not this module names the mechanism,
 * which is more use than saying nothing.
 */
function callSite(): string {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  const outside = frames.find((frame) => !frame.includes(HERE));

  if (outside !== undefined) return shorten(outside);

  // No application frame: the runtime wrote this, and naming the frame that
  // happened to be innermost would be precision the entry does not have.
  return frames.length === 0 ? UNKNOWN : INTERNAL;
}

/** Enough of a value to recognise it, never enough to flood the line. */
function render(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) return `Array(${String(value.length)})`;

    return `{${Object.keys(value).slice(0, KEYS).join(', ')}}`;
  }

  const text = String(value);

  return text.length > VALUE_CHARS ? `${text.slice(0, VALUE_CHARS)}…` : text;
}

function idOf(node: object): number {
  const known = ids.get(node);

  if (known !== undefined) return known;

  nextId += 1;
  ids.set(node, nextId);

  return nextId;
}

function describe(node: Node): string {
  const element = node.nodeType === NodeType.Element ? (node as Element) : node.parentElement;

  return element === null ? '#text' : `<${element.tagName.toLowerCase()}>`;
}

/** Opens a chain. Called from a signal write, which is the only thing that can. */
export function traceWrite(from: unknown, to: unknown): void {
  if (!recording) return;

  const now = Date.now();

  if (!admits(now)) return;

  // A write while a chain is draining is part of that chain, not a new one:
  // `each` writing a row's item *is* the list update it was asked to make.
  if (current === 0) {
    nextCause += 1;
    current = nextCause;
  }

  push({
    at: now - started,
    cause: current,
    kind: TraceKind.Write,
    source: callSite(),
    from: render(from),
    to: render(to),
  });
}

/** A derivation re-ran and changed. */
export function traceCompute(node: object): void {
  if (!recording || current === 0) return;

  push({
    at: Date.now() - started,
    cause: current,
    kind: TraceKind.Compute,
    source: `computed #${String(idOf(node))}`,
  });
}

/** The DOM was written. */
export function tracePatch(target: Node): void {
  if (!recording || current === 0) return;

  push({
    at: Date.now() - started,
    cause: current,
    kind: TraceKind.Patch,
    source: describe(target),
  });
}

/** Remembers which chain queued this watcher, for a frame from now. */
export function traceQueued(job: object): void {
  if (!recording) return;

  stamps.set(job, current);
}

/** Restores the chain a watcher was queued by, before it runs. */
export function traceRunning(job: object): void {
  if (!recording) return;

  current = stamps.get(job) ?? 0;
}

/** Closes the chain: a write after this one starts its own. */
export function traceIdle(): void {
  if (!recording) return;

  current = 0;
}

function start(): void {
  recording = true;
  started = Date.now();
  windowOpened = started;
  inWindow = 0;
}

function stop(): void {
  recording = false;
  current = 0;
}

function clear(): void {
  buffer.length = 0;
  dropped = 0;
  current = 0;
}

function report(): TraceReport {
  return { depth: DEPTH, dropped, entries: [...buffer] };
}

const INDENT = '    ';

function step(entry: TraceEntry): string {
  if (entry.kind === TraceKind.Write) {
    return `write(${entry.from ?? ''} → ${entry.to ?? ''}) @ ${entry.source}`;
  }

  if (entry.kind === TraceKind.Compute) return `${entry.source} recomputed`;

  return `patched ${entry.source}`;
}

function line(entry: TraceEntry, depth: number): string {
  // Only the head of a chain sits at the margin. A write nested inside one is
  // a consequence like any other and is indented like any other.
  if (depth === 0) return step(entry);

  return `${INDENT.repeat(depth - 1)}  └─ ${step(entry)}`;
}

/** The same chains as `trace()`, shaped for a person rather than a program. */
function format(): string {
  const lines: string[] = [];
  let cause = 0;
  let depth = 0;

  for (const entry of buffer) {
    if (entry.cause !== cause) {
      cause = entry.cause;
      depth = 0;
    } else {
      depth += 1;
    }

    lines.push(line(entry, depth));
  }

  return lines.join('\n');
}

/**
 * Installs the dev-build debugging surface. A global registry is what this
 * spec rejects everywhere else (SPEC §7 says so out loud); it is defensible
 * only because it has no role in application code and does not exist in a
 * production build.
 */
export function installTrace(): void {
  const host = globalThis as unknown as Record<string, unknown>;

  if (host['__sheratan'] !== undefined) return;

  host['__sheratan'] = { start, stop, clear, trace: report, format };
}
