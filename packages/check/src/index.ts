// The checker's public surface. The CLI and, later, an editor extension call
// this; neither reaches past it.

export { checkProject, type CheckOptions } from './check.ts';
export { RuleCode, Severity, type Finding, type Position } from './finding.ts';
