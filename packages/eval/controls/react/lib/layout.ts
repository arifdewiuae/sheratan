// Layout numbers the view writes into CSS and the window arithmetic reads
// back. One home, so a stylesheet and a measurement cannot drift apart.

/** Height of one row in CSS pixels. The component publishes it as `--row-h`. */
export const ROW_HEIGHT_PX = 32;

/** The list's scroll viewport in CSS pixels. The component publishes it as `--list-h`. */
export const LIST_HEIGHT_PX = 416;

/** Rows kept above and below the viewport, so a fast scroll never shows a gap. */
export const OVERSCAN_ROWS = 6;

/** Overscan is paid at the top of the window and again at the bottom. */
const ENDS = 2;

/**
 * The size of the row pool: what fits, plus overscan at both ends. Policy, not
 * mechanism — the list is told this number, it does not decide it.
 */
export const WINDOW_ROWS = Math.ceil(LIST_HEIGHT_PX / ROW_HEIGHT_PX) + OVERSCAN_ROWS * ENDS;
