// Effects: the only impure file (SPEC §4). It loads the rules, and submits the
// draft through a `mutation()` whose every hook is a transition: whether a
// submit may send is a question it asks state, never one it answers itself
// (SPEC §4b, §6 Forms).

import { mutation, onDispose } from 'sheratan';

import type { AlertsApi, NewRule, RuleAnswer } from '../../services/alerts.contract.ts';
import type { AlertsState } from './alerts.state.ts';

/** What this module can do. The view declares the same shape for itself. */
export interface AlertsEffects {
  start(this: void): void;
  edited(this: void, fields: Readonly<Record<string, string>>): void;
  submit(this: void): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** Loads the rules once, and saves a new one when asked. */
export function createAlertsEffects(api: AlertsApi, state: AlertsState): AlertsEffects {
  const controller = new AbortController();

  onDispose(() => {
    controller.abort();
  });

  const save = mutation<NewRule, RuleAnswer>({
    send: ({ input, signal }) => api.add(input, signal),
    optimistic: state.sending,
    rollback: state.notSent,
    onSuccess: state.answered,
  });

  const load = async (): Promise<void> => {
    try {
      state.listed(await api.list(controller.signal));
    } catch (error: unknown) {
      // An abort is the module unmounting, and the runtime drops this write
      // then (SPEC §5b rule 1), so it is never reported as a failure.
      state.failed(messageOf(error));
    }
  };

  return {
    start: () => {
      void load();
    },

    edited: (fields) => {
      state.rule.edited(fields);
    },

    // `sending` runs inside `run()`, so a second click in the same frame
    // already reads `ready()` as false: one rule, however fast the clicks.
    submit: () => {
      state.rule.attempted();

      if (state.ready()) void save.run(state.draft());
    },
  };
}
