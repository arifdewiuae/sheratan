// State: signals and pure transitions. No I/O, no DOM (SPEC §4). The draft
// rule is a `form()` (SPEC §6 Forms): what to show under each field is derived
// there, and this file decides only what an answer from the server means.

import { batch, computed, form, signal, type Accessor, type Form, type Signal } from 'sheratan';

import type { AlertRule, NewRule, RuleAnswer } from '../../services/alerts.contract.ts';

/** The metrics a rule may watch: the dashboard's row names. */
export const METRICS = [
  'cache',
  'errors',
  'latency',
  'orders',
  'queue',
  'retries',
  'sessions',
  'throughput',
] as const;

/** The draft rule, field by field, as the form holds it. */
export interface RuleFields {
  readonly metric: string;
  readonly above: string;
  readonly below: string;
}

/** Readable state plus the transitions that may change it (SHR-L010). */
export interface AlertsState {
  readonly rules: Accessor<readonly AlertRule[]>;
  readonly rule: Form<RuleFields>;
  /** A save is in flight. */
  readonly saving: Accessor<boolean>;
  /** Why the last save or load did not happen, or `''`. */
  readonly failure: Accessor<string>;
  /** The draft as the server takes it, with its numbers parsed. */
  readonly draft: Accessor<NewRule>;
  /** The draft passes its checks and nothing is in flight: a submit may send. */
  readonly ready: Accessor<boolean>;
  listed(this: void, rules: readonly AlertRule[]): void;
  failed(this: void, reason: string): void;
  sending(this: void): void;
  notSent(this: void): void;
  answered(this: void, answer: RuleAnswer): void;
}

/** The writable handles, which never leave this file. */
interface Signals {
  readonly rules: Signal<readonly AlertRule[]>;
  readonly saving: Signal<boolean>;
  readonly failure: Signal<string>;
}

const NO_FAILURE = '';
const NOT_SENT = 'The rule was not saved. Try again.';
const CHOOSE_A_METRIC = 'Choose a metric';
const ENTER_A_NUMBER = 'Enter a number';
const UNDER_THE_ALARM = 'Must be under the alarm level';

/** A whole or decimal number, as typed: `Number('')` is 0, which is not an answer. */
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** The alarm needs a number; going off again needs a smaller one. */
function check({ metric, above, below }: RuleFields): Partial<RuleFields> {
  const belowMessage = Number(below) < Number(above) ? '' : UNDER_THE_ALARM;

  return {
    metric: metric === '' ? CHOOSE_A_METRIC : '',
    above: NUMBER.test(above) ? '' : ENTER_A_NUMBER,
    below: NUMBER.test(below) ? belowMessage : ENTER_A_NUMBER,
  };
}

/** Signals and the transitions that may write them; nothing else leaves. */
export function createAlertsState(): AlertsState {
  const signals: Signals = {
    rules: signal<readonly AlertRule[]>([]),
    saving: signal(false),
    failure: signal(NO_FAILURE),
  };

  const rule = form({ fields: { metric: '', above: '', below: '' }, check });

  const draft = computed((): NewRule => {
    const { metric, above, below } = rule.values();

    return { metric, above: Number(above), below: Number(below) };
  });

  return {
    rules: signals.rules,
    rule,
    saving: signals.saving,
    failure: signals.failure,
    draft,
    ready: computed(() => rule.valid() && !signals.saving()),

    listed: (rules) => {
      signals.rules.set(rules);
    },

    failed: (reason) => {
      signals.failure.set(reason);
    },

    sending: () => {
      batch(() => {
        signals.saving.set(true);
        signals.failure.set(NO_FAILURE);
      });
    },

    notSent: () => {
      batch(() => {
        signals.saving.set(false);
        signals.failure.set(NOT_SENT);
      });
    },

    answered: (answer) => {
      batch(() => {
        signals.saving.set(false);

        if ('errors' in answer) {
          rule.rejected(answer.errors);

          return;
        }

        signals.rules.set([...signals.rules(), answer.rule]);
        rule.reset();
      });
    },
  };
}
