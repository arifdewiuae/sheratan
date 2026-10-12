// Forms (SPEC §6, ADR 0006). A form is state: its values, which fields have
// changed, whether a submit was attempted and what the server said are one
// immutable draft in one signal, so every transition is a single write and
// what to show is derived from the draft rather than kept in step with it.

import { computed } from './computed.ts';
import { signal } from './signal.ts';
import type { Accessor } from './types.ts';

/** A form's fields: a string per name, which is what a control holds. */
export type FormFields<F> = { readonly [K in keyof F]: string };

/** A message per field, `''` for none. */
export type FormErrors<F> = { readonly [K in keyof F]: string };

/** How a form is described. Only `fields` is required. */
export interface FormOptions<F extends FormFields<F>> {
  /** Every field the form has, with its initial value. */
  readonly fields: F;
  /** A message per field for the values as they stand, `''` for none. */
  readonly check?: (values: F) => Partial<FormErrors<F>>;
}

/** A form's state: three accessors to show it and four transitions to change it. */
export interface Form<F extends FormFields<F>> {
  /** The current value of every field. */
  readonly values: Accessor<F>;
  /**
   * What to show per field: the server's message until that field changes,
   * otherwise `check`'s once the field has changed or after `attempted()`.
   */
  readonly errors: Accessor<FormErrors<F>>;
  /** `check` reports nothing, whether or not its messages are shown. */
  readonly valid: Accessor<boolean>;
  /** Takes a `<form>`'s payload (SPEC §9). A field it did not report becomes `''`. */
  readonly edited: (reported: Readonly<Record<string, string>>) => void;
  /** Shows every field's `check` message, changed or not. */
  readonly attempted: () => void;
  /** Records the server's messages, replacing any it sent before. */
  readonly rejected: (messages: Partial<FormErrors<F>>) => void;
  /** Back to the initial values, with nothing shown. */
  readonly reset: () => void;
}

/** Messages for some of the fields: the shape `check` and the server answer in. */
type Messages<F> = Partial<FormErrors<F>>;

/** Everything a form knows, replaced whole on every transition. */
interface Draft<F> {
  readonly values: F;
  readonly changed: Partial<Record<keyof F, true>>;
  readonly attempted: boolean;
  readonly server: Messages<F>;
}

/** The draft after a `<form>` reported `reported`, or the same draft if nothing moved. */
function edit<F extends FormFields<F>>(
  draft: Draft<F>,
  names: readonly (keyof F)[],
  reported: Readonly<Record<string, string>>,
): Draft<F> {
  const values: Partial<Record<keyof F, string>> = {};
  const changed = { ...draft.changed };
  const server = { ...draft.server };
  let moved = false;

  for (const name of names) {
    const value = reported[name as string] ?? '';

    values[name] = value;

    if (value !== draft.values[name]) {
      moved = true;
      changed[name] = true;
      server[name] = '';
    }
  }

  if (!moved) return draft;

  return { ...draft, values: values as F, changed, server };
}

/** One field's message: the server's first, then `check`'s if the field is shown. */
function messageOf<F>(name: keyof F, draft: Draft<F>, checked: Messages<F>): string {
  const said = draft.server[name] ?? '';

  if (said !== '') return said;

  if (!draft.attempted && draft.changed[name] !== true) return '';

  return checked[name] ?? '';
}

/**
 * A form's state, created in `*.state.ts` like a signal. Values are strings;
 * `check` returns a message per field, `''` for none. A field's message shows
 * once that field has changed or after `attempted()`; the server's, recorded
 * by `rejected()`, until that field changes (SPEC §6 Forms).
 *
 * @example
 * const rule = form({
 *   fields: { above: '', below: '' },
 *   check: ({ above, below }) => ({
 *     below: Number(below) < Number(above) ? '' : 'Must be under the alarm level',
 *   }),
 * });
 * // a view: <form @input=${intent.edited}> … ${() => rule.errors().below}
 */
export function form<F extends FormFields<F>>(options: FormOptions<F>): Form<F> {
  const { fields, check } = options;
  const names = Object.keys(fields) as (keyof F)[];
  const initial: Draft<F> = { values: fields, changed: {}, attempted: false, server: {} };
  const draft = signal(initial);
  // A draft of strings is its own DeepReadonly; the compiler cannot see that for a generic F.
  const current = draft as unknown as Accessor<Draft<F>>;
  const values = computed(() => current().values) as Accessor<F>;

  const checked = computed((): Messages<F> => check?.(values()) ?? {}) as Accessor<Messages<F>>;

  const errors = computed(() => {
    const now = current();

    return Object.fromEntries(names.map((name) => [name, messageOf(name, now, checked())]));
  }) as Accessor<FormErrors<F>>;

  return {
    values,
    errors,
    valid: computed(() => names.every((name) => (checked()[name] ?? '') === '')),
    edited: (reported) => {
      draft.set(edit(current(), names, reported));
    },
    attempted: () => {
      draft.set({ ...current(), attempted: true });
    },
    rejected: (messages) => {
      draft.set({ ...current(), server: messages });
    },
    reset: () => {
      draft.set(initial);
    },
  };
}
