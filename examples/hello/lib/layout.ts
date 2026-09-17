// Layout numbers the view writes into CSS and the window arithmetic reads back.
// One home, so a stylesheet and a measurement cannot drift apart.

/** Height of one table row in CSS pixels. The view publishes it as `--row-h`. */
export const ROW_HEIGHT_PX = 30;

/** The table's scroll viewport in CSS pixels. The view publishes it as `--list-h`. */
export const LIST_HEIGHT_PX = 384;

/** Rows kept above and below the viewport, so a fast scroll never shows a gap. */
export const OVERSCAN_ROWS = 6;

/** Overscan is paid at the top of the window and again at the bottom. */
const ENDS = 2;

/**
 * The size of the row pool: what fits, plus overscan at both ends. Policy, not
 * mechanism — `each` is told this number, it does not decide it (ADR 0003).
 */
export const WINDOW_ROWS = Math.ceil(LIST_HEIGHT_PX / ROW_HEIGHT_PX) + OVERSCAN_ROWS * ENDS;
