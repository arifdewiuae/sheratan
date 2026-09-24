// Everything one task run needs standing up, and torn down again: a sandbox
// with the arm scaffolded into it, `evalkit` behind it, the arm's own dev
// server, and the proxy that makes those last two one origin.
//
// The hidden suite is not here and never is. It runs from this package, in
// this repository, against `origin` — so ten iterations of an agent with a
// shell cannot read it, because it was never in the directory the agent has.

import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { startEvalkit, type Evalkit } from '../evalkit/src/server.ts';
import { startProxy, type Proxy } from './proxy.ts';
import type { Arm, Command } from './arm.ts';
import type { CleanRun } from './iterate.ts';

/** How long the arm's dev server may take to answer before the run is abandoned. */
const SERVER_TIMEOUT_MS = 60_000;

/** How often the harness asks whether it is up yet. */
const POLL_MS = 200;

/** How long one clean command may take. A cold type-check is not instant. */
const CLEAN_TIMEOUT_MS = 180_000;

/** Where a server announces itself, which is how the arm's real port is learnt. */
const ANNOUNCED = /https?:\/\/[^\s/]*:(\d+)/u;

/** What a run is staged on. Disposing it stops everything and deletes the tree. */
export interface Stage extends AsyncDisposable {
  /** The sandbox. The agent's working directory, and the only one it is given. */
  readonly root: string;
  /** The one origin: the app, with `/api` and `/ws` behind it. */
  readonly origin: string;
  /** `evalkit` directly, which is how a hidden test reaches the control API. */
  readonly backend: string;
  /** Test-only surfaces asked for at `origin`. Non-empty voids the run. */
  tampering(): readonly string[];
  /** Runs every command the arm calls clean, and stops at the first failure. */
  clean(): Promise<CleanRun>;
}

function environment(root: string): NodeJS.ProcessEnv {
  const bin = join(root, 'node_modules', '.bin');

  return { ...process.env, PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}` };
}

/** Runs one command to completion and keeps everything it said. */
async function runCommand(root: string, command: Command): Promise<CleanRun> {
  return new Promise<CleanRun>((settle) => {
    const child = spawn(command.run, [...command.args], {
      cwd: root,
      env: environment(root),
      timeout: CLEAN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';

    const take = (chunk: Buffer): void => {
      output += chunk.toString();
    };

    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (error) => settle({ ok: false, output: `${output}${error.message}` }));
    child.on('close', (code) => settle({ ok: code === 0, output }));
  });
}

/**
 * Every clean command, in order, stopping at the first that fails. The agent
 * is shown the output of the one that failed, which is what a person running
 * them by hand would see.
 */
async function cleanOf(root: string, arm: Arm): Promise<CleanRun> {
  const outputs: string[] = [];

  for (const command of arm.clean) {
    // eslint-disable-next-line no-await-in-loop -- in order, and the first failure stops it
    const run = await runCommand(root, command);

    outputs.push(run.output);

    if (!run.ok) return { ok: false, output: outputs.join('\n') };
  }

  return { ok: true, output: outputs.join('\n') };
}

/** A port nothing is listening on, which the arm's server is then asked for. */
async function freePort(): Promise<number> {
  const probe = createServer();

  await new Promise<void>((settle) => void probe.listen(0, '127.0.0.1', settle));

  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  await new Promise<void>((settle) => void probe.close(() => settle()));

  return port;
}

/** The arm's dev server, and where it actually ended up listening. */
interface Serving {
  readonly child: ChildProcess;
  readonly origin: string;
}

/**
 * Waits for the server to answer, at the port it was asked for or at the one
 * it says it took. A dev server free to move when a port is busy — Sheratan's
 * does — would otherwise leave the proxy pointed at nothing.
 */
async function answering(child: ChildProcess, asked: number, said: () => string): Promise<string> {
  const until = Date.now() + SERVER_TIMEOUT_MS;

  while (Date.now() < until) {
    if (child.exitCode !== null) {
      throw new Error(`the arm's server exited with ${String(child.exitCode)}: ${said()}`);
    }

    const announced = ANNOUNCED.exec(said());
    const origin = `http://127.0.0.1:${announced?.[1] ?? String(asked)}`;

    try {
      // eslint-disable-next-line no-await-in-loop -- polling is the point: it is up or it is not
      await fetch(`${origin}/`);

      return origin;
    } catch {
      // eslint-disable-next-line no-await-in-loop -- one wait between two polls
      await new Promise<void>((settle) => void setTimeout(settle, POLL_MS));
    }
  }

  throw new Error(`the arm's server said nothing in ${String(SERVER_TIMEOUT_MS)}ms: ${said()}`);
}

/** Starts the arm's dev server and waits until it answers. */
async function startServing(root: string, arm: Arm): Promise<Serving> {
  const asked = await freePort();
  const command = arm.serving(asked);

  const child = spawn(command.run, [...command.args], {
    cwd: root,
    env: environment(root),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';

  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString();
  });

  child.stderr.on('data', (chunk: Buffer) => {
    out += chunk.toString();
  });

  return { child, origin: await answering(child, asked, () => out) };
}

/** What a stage is built with. */
export interface StageOptions {
  readonly arm: Arm;
  /** Fixes the backend's fixture data, so a seed means the same thing twice. */
  readonly seed?: number;
}

/**
 * Stands one run up. The caller disposes it, which stops the servers and
 * removes the sandbox — including after a failure, which is why everything
 * built here is registered before the next thing is started.
 *
 * @example
 * await using stage = await setUpStage({ arm: sheratanArm });
 */
export async function setUpStage(options: StageOptions): Promise<Stage> {
  const root = await mkdtemp(resolve(tmpdir(), `sheratan-eval-${options.arm.id}-`));

  let kit: Evalkit | undefined = undefined;
  let serving: Serving | undefined = undefined;
  let proxy: Proxy | undefined = undefined;

  const stop = async (): Promise<void> => {
    await proxy?.[Symbol.asyncDispose]();

    serving?.child.kill();

    await kit?.close();
    await rm(root, { recursive: true, force: true });
  };

  try {
    await options.arm.scaffold(root);

    kit = await startEvalkit(options.seed === undefined ? {} : { seed: options.seed });
    serving = await startServing(root, options.arm);
    proxy = await startProxy({ app: serving.origin, backend: kit.url });
  } catch (error) {
    await stop();

    throw error;
  }

  const open = proxy;
  const backend = kit.url;

  return {
    root,
    origin: open.url,
    backend,
    tampering: () => open.tampering(),
    clean: async () => cleanOf(root, options.arm),
    [Symbol.asyncDispose]: stop,
  };
}
