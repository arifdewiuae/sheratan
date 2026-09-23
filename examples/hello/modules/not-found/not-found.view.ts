// A `view` module: what the outer route table shows when no pattern matches
// (SPEC §4). A table says this for itself rather than the router guessing.

import { html, location, type Template } from 'sheratan';

/** What the outer table shows when no pattern matched. */
export function notFoundView(): Template {
  return html`<section class="not-found" data-screen="not-found">
    <h2>No such page</h2>
    <p class="note">Nothing is routed at <code data-path>${() => location().pathname}</code>.</p>
    <a href="/" data-link="home">Back to the dashboard</a>
  </section>`;
}
