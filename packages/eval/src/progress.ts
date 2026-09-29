// Where a grid is, for the two readers who wait on it.
//
// A matrix is hours of cells that each take minutes, and a line printed only
// when a cell finishes leaves ten minutes of silence that reads as a hang. So
// the grid reports every turn and every verdict, twice over: a bar redrawn in
// place for a person at a terminal, and `progress.json` plus an append-only
// `progress.log` in the results directory for anyone watching from outside —
// another terminal, or the agent that launched it.
//
// Nothing here reaches a measurement. The arithmetic is pure and tested in
// `test/progress.test.ts`; the watcher is the only part that writes.

import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Phase, type Step } from './iterate.ts';

/** How many characters the bar is, filled and empty together. */
const BAR_WIDTH = 24;
const FILLED = '█';
const EMPTY = '░';
const PERCENT = 100;
const MONEY = 2;
const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 3600;
const PAD = 2;
const INDENT = 2;
/** How often the bar is redrawn while nothing happens, so its clock moves. */
const TICK_MS = 1000;
/** Carriage return and erase-to-end-of-line: redraw the bar where it stands. */
const REDRAW = '\r\u001B[K';

/** Where the grid is at one instant. */
export interface Progress {
  readonly total: number;
  /** Cells finished, read back from disk included. */
  readonly done: number;
  /** How long each cell *run in this process* took; a reused cell took nothing. */
  readonly ranMs: readonly number[];
  /** Spent on finished cells, plus the running one so far. */
  readonly spentUSD: number;
  readonly current?: {
    readonly stem: string;
    readonly startedAt: number;
    readonly step?: Step;
    readonly stepAt?: number;
  };
  readonly now: number;
}

/**
 * A bar of `width` characters, `done` of `total` filled.
 *
 * @example
 * barOf(1, 2, 4); // '██░░'
 */
export function barOf(done: number, total: number, width: number = BAR_WIDTH): string {
  const filled = total === 0 ? width : Math.round((done / total) * width);

  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

/**
 * A duration as a person reads it: `42s`, `4m05s`, `1h10m`.
 *
 * @example
 * clockOf(65_000); // '1m05s'
 */
export function clockOf(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / SECOND_MS));

  if (seconds < MINUTE_S) return `${String(seconds)}s`;

  const minutes = Math.floor(seconds / MINUTE_S);

  if (seconds < HOUR_S) {
    return `${String(minutes)}m${String(seconds % MINUTE_S).padStart(PAD, '0')}s`;
  }

  const hours = Math.floor(seconds / HOUR_S);

  return `${String(hours)}h${String(minutes % MINUTE_S).padStart(PAD, '0')}m`;
}

/**
 * Time left, from the mean of the cells run so far: every unfinished cell
 * costs the mean, less what the running one has already used. Nothing until
 * a cell has run, because a guess before the first is a number made up.
 *
 * @example
 * remainingMs([60_000], 3, 20_000); // 160_000
 */
export function remainingMs(
  ranMs: readonly number[],
  left: number,
  runningFor: number,
): number | undefined {
  if (ranMs.length === 0) return undefined;

  const mean = ranMs.reduce((sum, ms) => sum + ms, 0) / ranMs.length;

  return Math.max(0, mean * left - runningFor);
}

/** How each phase reads on the bar. */
const DOING: Readonly<Record<Phase, string>> = {
  [Phase.Working]: 'agent working',
  [Phase.Judging]: 'judging',
  [Phase.Judged]: 'judged',
};

/** What the running cell is doing, e.g. `iteration 2/10 · agent working 3m10s`. */
function doingOf(progress: Progress): string {
  const current = progress.current;

  if (current === undefined) return '';

  const step = current.step;
  const since = clockOf(progress.now - (current.stepAt ?? current.startedAt));

  if (step === undefined) return ` · ${current.stem} · starting ${since}`;

  return ` · ${current.stem} · iteration ${String(step.n)}/${String(step.cap)} · ${DOING[step.phase]} ${since}`;
}

/**
 * The one status line: where the grid is, what it has cost, when it ends,
 * and what the running cell is doing.
 *
 * @example
 * statusOf(progress); // '[7/18] ██████████░░░░ 39% · $14.20 · ~1h10m left · T03-react-seed2 · …'
 */
export function statusOf(progress: Progress): string {
  const { done, total } = progress;
  const percent = total === 0 ? PERCENT : Math.floor((done / total) * PERCENT);
  const runningFor = progress.current === undefined ? 0 : progress.now - progress.current.startedAt;
  const left = remainingMs(progress.ranMs, total - done, runningFor);
  const eta = left === undefined ? 'time left after the first cell' : `~${clockOf(left)} left`;

  return (
    `[${String(done)}/${String(total)}] ${barOf(done, total)} ${String(percent)}% · ` +
    `$${progress.spentUSD.toFixed(MONEY)} · ${eta}${doingOf(progress)}`
  );
}

/**
 * One verdict as a line, e.g. `T01-react-seed1 · iteration 1: checker clean, 2 tests failing`.
 *
 * @example
 * verdictLineOf('T01-react-seed1', step);
 */
export function verdictLineOf(stem: string, step: Step): string {
  const result = step.result;

  if (result === undefined) return `${stem} · iteration ${String(step.n)}`;

  if (result.pass) return `${stem} · iteration ${String(step.n)}: green`;

  const checker = result.clean.ok ? 'checker clean' : 'checker NOT clean';
  const failing = result.suite.failing.length;
  const tests = result.suite.ok ? 'tests green' : `${String(failing)} tests failing`;

  return `${stem} · iteration ${String(step.n)}: ${checker}, ${tests}`;
}

/** Writes the snapshot another process reads, and adds `line` to the log. */
function record(into: string, line: string, progress: Progress, startedAt: number): void {
  appendFileSync(join(into, 'progress.log'), `${new Date().toISOString()} ${line}\n`);

  writeFileSync(
    join(into, 'progress.json'),
    `${JSON.stringify({ status: statusOf(progress), startedAt, ...progress }, null, INDENT)}\n`,
  );
}

/** Where a watcher writes, injected so it can be pointed anywhere. */
export interface WatcherOptions {
  readonly total: number;
  /** The results directory, which gets `progress.json` and `progress.log`. */
  readonly into: string;
  readonly out: NodeJS.WriteStream;
}

/** What the grid tells its watcher. */
export interface Watcher {
  begin(stem: string): void;
  step(step: Step): void;
  /** A cell is finished; `ranMs` is undefined when it was read back from disk. */
  finish(line: string, costUSD: number, ranMs: number | undefined): void;
  stop(): void;
}

/**
 * The grid's two displays: a bar redrawn in place when `out` is a terminal
 * (plain lines otherwise), and a snapshot and log on disk that any other
 * process can read while the grid runs.
 *
 * @example
 * const watcher = watch({ total: planned.length, into, out: process.stdout });
 */
export function watch(options: WatcherOptions): Watcher {
  const ranMs: number[] = [];
  const started = Date.now();
  const tty = options.out.isTTY;

  let done = 0;
  let spentUSD = 0;
  let current: Progress['current'];

  const snapshot = (): Progress => ({
    total: options.total,
    done,
    ranMs,
    spentUSD: spentUSD + (current?.step?.spentUSD ?? 0),
    ...(current === undefined ? {} : { current }),
    now: Date.now(),
  });

  const draw = (): void => {
    if (tty) options.out.write(`${REDRAW}${statusOf(snapshot())}`);
  };

  const note = (line: string): void => {
    const now = snapshot();

    options.out.write(tty ? `${REDRAW}${line}\n` : `${line}\n${statusOf(now)}\n`);
    record(options.into, line, now, started);

    draw();
  };

  const ticker = setInterval(draw, TICK_MS);

  ticker.unref();

  return {
    begin(stem) {
      current = { stem, startedAt: Date.now() };
      note(`${stem} · started`);
    },

    step(step) {
      if (current === undefined) return;

      current = { ...current, step, stepAt: Date.now() };

      if (step.phase === Phase.Judged) note(verdictLineOf(current.stem, step));
      else draw();
    },

    finish(line, costUSD, ran) {
      done += 1;
      spentUSD += costUSD;
      current = undefined;

      if (ran !== undefined) ranMs.push(ran);

      note(line);
    },

    stop() {
      clearInterval(ticker);

      if (tty) options.out.write('\n');
    },
  };
}
