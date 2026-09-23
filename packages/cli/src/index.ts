// The CLI's public surface. `bin/sheratan.ts` is the only caller in this
// repo; an editor extension would be the second.

export { buildProject, type Built, type BuildOptions } from './build.ts';
export { report, reportJson, REPORT_VERSION, type Report } from './report.ts';
export { run } from './run.ts';
export { serve, type DevOptions, type DevServer } from './serve.ts';
export { Exit, type Terminal } from './terminal.ts';
