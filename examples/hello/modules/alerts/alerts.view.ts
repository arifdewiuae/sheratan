// View: a pure function of state (SPEC §4). No I/O, no imports of effects.
// The form reports every field on every input (SPEC §9 Intents), so one
// handler keeps the draft current and no input needs wiring of its own; each
// control's `.value` is bound back, which is how `reset()` empties them.

import { computed, each, html, type Accessor, type Template } from 'sheratan';

import type { AlertRule } from '../../services/alerts.contract.ts';
import { METRICS, type AlertsState, type RuleFields } from './alerts.state.ts';

/** What this view asks the module to do. */
export interface AlertsIntents {
  edited(this: void, fields: Readonly<Record<string, string>>): void;
  submit(this: void): void;
}

const ADD = 'Add rule';
const SAVING = 'Saving…';

/** One kept rule, in words. */
function ruleRow(rule: Accessor<AlertRule>): Template {
  const metric = computed(() => rule().metric);
  const above = computed(() => String(rule().above));
  const below = computed(() => String(rule().below));

  return html`<li class="rule" data-rule>
    <span class="rule-metric">${metric}</span>
    <span class="rule-levels">alarm at ${above}, clear under ${below}</span>
  </li>`;
}

function metricOption(name: Accessor<string>): Template {
  return html`<option value=${name}>${name}</option>`;
}

/** A labelled control with the message the form shows under it. */
function field(
  state: AlertsState,
  name: keyof RuleFields,
  label: string,
  control: Template,
): Template {
  const message = computed(() => state.rule.errors()[name]);
  const quiet = computed(() => message() === '');

  return html`<label class="field">
    <span class="field-label">${label}</span>
    ${control}
    <span class="field-message" data-message=${name} aria-live="polite" hidden=${quiet}
      >${message}</span
    >
  </label>`;
}

/** The form that adds a rule. */
function ruleForm(state: AlertsState, intents: AlertsIntents): Template {
  const metric = computed(() => state.rule.values().metric);
  const above = computed(() => state.rule.values().above);
  const below = computed(() => state.rule.values().below);
  const label = computed(() => (state.saving() ? SAVING : ADD));

  const failure = computed(() => {
    if (state.failure() === '') return undefined;

    return html`<p class="note error" role="alert">${state.failure}</p>`;
  });

  const select = html`<select name="metric" .value=${metric}>
    <option value="">Choose…</option>
    ${each(METRICS, metricOption)}
  </select>`;

  return html`<form class="rule-form" novalidate @input=${intents.edited} @submit=${intents.submit}>
    ${field(state, 'metric', 'Metric', select)}
    ${field(state, 'above', 'Alarm at or above', html`<input name="above" inputmode="decimal" .value=${above} />`)}
    ${field(state, 'below', 'Clear under', html`<input name="below" inputmode="decimal" .value=${below} />`)}
    <button type="submit" disabled=${state.saving}>${label}</button>
    ${failure}
  </form>`;
}

/** The module's markup: the rules kept so far, and the form that adds one. */
export function alertsView(state: AlertsState, intents: AlertsIntents): Template {
  const count = computed(() => {
    const kept = state.rules().length;

    return kept === 1 ? '1 rule' : `${String(kept)} rules`;
  });

  return html`<section class="module-alerts" data-module="alerts">
    <nav class="alerts-nav">
      <a href="/" data-link="home">Dashboard</a>
      <span class="alerts-count" data-count>${count}</span>
    </nav>
    <h1 class="alerts-title">Alert rules</h1>
    <ul class="rules">
      ${each(state.rules, ruleRow)}
    </ul>
    ${ruleForm(state, intents)}
  </section>`;
}
