// An in-memory rule store, so the example needs no server. It answers like a
// real one would: after a delay, and with field errors rather than a throw
// when a rule cannot be kept. A real app swaps this for an HTTP adapter that
// maps a 422 onto the same `errors` answer, and changes nothing else.

import type { AlertRule, AlertsApi, NewRule, RuleAnswer } from './alerts.contract.ts';

/** Long enough to see the button say so, short enough not to annoy. */
const DEFAULT_LATENCY_MS = 400;

const ONE_RULE_PER_METRIC = 'This metric already has a rule';

/** How the store starts. */
export interface MemoryAlertsOptions {
  readonly rules?: readonly NewRule[];
  readonly latencyMs?: number;
}

/** Resolves after `ms`, or rejects with the signal's reason if it aborts first. */
function after<T>(ms: number, signal: AbortSignal, answer: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(answer());
    }, ms);

    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

/** A rule store held in memory, one rule per metric. */
export function createMemoryAlerts(options: MemoryAlertsOptions = {}): AlertsApi {
  const latency = options.latencyMs ?? DEFAULT_LATENCY_MS;
  const seeded = options.rules ?? [];

  let kept: readonly AlertRule[] = seeded.map(({ metric, above, below }, index) => ({
    id: index + 1,
    metric,
    above,
    below,
  }));

  const keep = (rule: NewRule): RuleAnswer => {
    if (kept.some((existing) => existing.metric === rule.metric)) {
      return { errors: { metric: ONE_RULE_PER_METRIC } };
    }

    const added: AlertRule = { ...rule, id: kept.length + 1 };

    kept = [...kept, added];

    return { rule: added };
  };

  return {
    list: (signal) => after(latency, signal, () => kept),
    add: (rule, signal) => after(latency, signal, () => keep(rule)),
  };
}
