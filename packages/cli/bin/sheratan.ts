#!/usr/bin/env node
// The process boundary, and the only file in this folder that owns one: it
// hands `run()` the real streams and takes back an exit code.

import { run } from '../src/run.ts';

/** `argv` starts with the runtime and this file; the command's own words follow. */
const ARGUMENTS_START = 2;

const line = (stream: NodeJS.WriteStream, text: string): void => {
  stream.write(`${text}\n`);
};

const terminal = {
  out: (text: string): void => {
    line(process.stdout, text);
  },
  err: (text: string): void => {
    line(process.stderr, text);
  },
  // NO_COLOR is honoured by every tool that colours, and a pipe gets none either.
  colour: process.stdout.isTTY && process.env['NO_COLOR'] === undefined,
};

process.exitCode = await run(process.argv.slice(ARGUMENTS_START), terminal);
