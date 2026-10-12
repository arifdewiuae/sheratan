# 0006 — A form is state: `form()` lives in `*.state.ts`, and submitting is a `mutation()`

**Status:** accepted, 2026-10-12 · implements SPEC §6 "Forms" and amends §9 "Intents" · Road to 0.1.0, step 3

## Context

PLAN puts forms on the must-list, and SPEC §12 promises a reference app with
one. What the runtime had was a single rule: a `submit` intent receives
`Object.fromEntries(new FormData(form))` with the default prevented. Every other
part of a form was left to each app, and those are exactly the parts that go
wrong when written by hand:

- an error shown before the user has typed anything, or never shown at all;
- a server error that stays under a field after the user has fixed it;
- a form that does not clear after a successful submit, because the inputs were
  never bound to anything that could be cleared;
- a double click that sends two creates, because `mutation()` with no `key`
  queues the second run behind the first — right for saving a record, wrong
  for creating one.

The void matrix (2026-09-29) showed agents grepping the core source for
`submit|FormData`: `llms.txt` did not say how a form works, and there was
nothing to say beyond the payload rule.

There is a constraint on how this can be documented. Week 0 task T03 is a
create form with validation, server field errors, a disabled submit and a reset
(`Docs/EVAL-TASKS.md` §3), and it is re-run in Road step 8. A worked form in
`llms.txt` — in any domain — would hand the Sheratan arm that task's recipe,
which is the contamination AGENTS.md forbids ("renaming the hooks does not make
it one that isn't"). So the design has to be documentable as an API, not as a
recipe.

## Decision

**A form is state, held by one primitive in `*.state.ts`.**

```ts
// alerts.state.ts
const rule = form({
  fields: { metric: '', above: '', below: '' },
  check: ({ above, below }) => ({
    above: isNumber(above) ? '' : 'Enter a number',
    below: Number(below) < Number(above) ? '' : 'Must be under the alarm level',
  }),
});
```

`form()` sits beside `signal()` and `computed()`: it creates signals, so it is
called where state is created, and what it returns is accessors and
transitions, so `SHR-L010` and `SHR-L005` apply to it unchanged.

| Member | Kind | Meaning |
|---|---|---|
| `values` | accessor | The current field values, `F` |
| `errors` | accessor | What to show, per field: a `check` error once the field has been changed or after `attempted()`, and a server error until that field changes |
| `valid` | accessor | `check` reports nothing, shown or not |
| `edited(fields)` | transition | Takes the `<form>`'s payload (§9); fields the form did not report become `''` |
| `attempted()` | transition | Shows every field's `check` error |
| `rejected(errors)` | transition | Records the server's field errors |
| `reset()` | transition | Back to the initial values, with nothing shown |

- **Values are strings.** That is what a form control holds; parsing is the
  `check` function's business and the transition's, not the primitive's.
- **`check` returns a message per field, `''` for none.** It receives every
  value, so a rule that relates two fields is an ordinary comparison. A value
  derived from several fields is a `computed` over `values`.
- **A field is shown once it has changed**, not on blur: blur needs a second
  event and a second intent, and "after the first edit" is what an agent
  writes when told nothing. `attempted()` shows the rest.
- **`edited()` replaces, it does not merge.** An unchecked checkbox is absent
  from `FormData`; a merge would keep it checked forever.

**A `<form>` reports its fields for every event, not only `submit`** (SPEC §9
amended). A handler on a `<form>` element receives the fields object whatever
the event, so `@input=${intent.edited}` on the form keeps the whole draft
current with one handler and no per-input wiring. `submit` additionally
prevents the default, as before. A form whose fields are not all text — a name
that appears twice, or a file input — fails loudly with `SHR-R010` rather than
silently keeping the last value (A2). Multi-value fields and uploads are
`[later]`.

**The server's field errors are the adapter's to translate.** The contract
method returns a union — `Promise<Created | { readonly errors: … }>` — and the
HTTP adapter maps a 422 onto its second half, so core knows nothing about
status codes, and an expected outcome is not an exception. Submitting is a
`mutation()` whose `onSuccess` is **one transition**, `answered(result)`, which
decides what the result means: `rule.rejected(…)`, or `rule.reset()` plus
whatever was created. The branch is in state, where SPEC §4b says business
meaning lives.

**A double submit is refused by state, with no new option on `mutation()`.**
The mutation's `optimistic` transition marks the form as sending, and state
exposes `ready = computed(() => rule.valid() && !sending())`. `optimistic` runs
synchronously inside `run()`, so a second click in the same frame — before the
disabled button has been painted — already reads `ready()` as false:

```ts
// alerts.effects.ts
submit: () => {
  state.rule.attempted();
  if (state.ready()) void save.run(state.rule.values());
},
```

SPEC §4b gains the rule that makes this legal: effects may branch on an
accessor that state computed, and may not compute the condition itself.

## Trade-off accepted

- **One more export** (A5): `form` and the `Form` type. The alternative is
  about thirty-five lines of signals and transitions per form, and a recipe in
  the documentation that is T03.
- **A second way to hold a value in state.** A form's values are signals behind
  an object rather than signals of their own. That is a narrower thing than a
  second state mechanism: `form()` is built from `signal()` and `computed()`,
  and its transitions are plain functions like any other.
- **Strings only.** A number field is parsed by the code that needs the number.
  Typed fields would need a schema, and a schema is a library.
- **`form()` in a view is not caught.** It would be state in the wrong layer,
  as `signal()` in a view already is and is not caught either. Logged in TASKS
  "Spec gaps" rather than given a rule before launch.
- **The `create` template does not get a form.** It is the scaffold the eval
  arm starts from. The worked example is `examples/hello` and SPEC §6, neither
  of which a confined agent can read; `llms.txt` carries the API row and the
  payload rule only.

## Rejected

- **No primitive: a form is plain signals and transitions.** The precedent is
  §5's "no `machine()` primitive", and it costs no API. It loses on the four
  failure modes above, which each app would have to get right separately, and
  on documentation: the only way to teach it is the five-step recipe the
  contamination rule forbids.
- **`whileRunning: 'ignore'` on `mutation()`.** Explicit and small, but it is
  API that duplicates what one `computed` already says, and it would leave
  `valid` and "sending" to be combined by hand anyway.
- **Server errors as a thrown `FieldErrors` class from core.** It puts HTTP
  semantics in the runtime, makes an expected outcome an exception, and lands
  the branch in effects, where it is a business-meaning `if`.

## Revisit when

- A real form needs a checkbox group, a multi-select or an upload. The answer is
  `string | readonly string[]` and `File` values, typed from `fields`.
- Showing errors on first edit proves wrong in use. The answer is a blur rule,
  not an option.
