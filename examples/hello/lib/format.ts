// Pure utilities with no app knowledge (SPEC §4 layout).

const THOUSAND = 1000;
const MILLION = 1_000_000;
const DECIMALS = 1;
const PERCENT = 100;

/** Compact number for a stat tile: 12_400 → "12.4k". */
export function compact(value: number): string {
  if (Math.abs(value) >= MILLION) return `${(value / MILLION).toFixed(DECIMALS)}M`;
  if (Math.abs(value) >= THOUSAND) return `${(value / THOUSAND).toFixed(DECIMALS)}k`;

  return String(Math.round(value));
}

/** A share as a whole percentage: 0.274 → "27%". */
export function percent(share: number): string {
  return `${String(Math.round(share * PERCENT))}%`;
}

/** A signed change, for the direction column: 12 → "+12". */
export function signed(delta: number): string {
  return delta > 0 ? `+${String(delta)}` : String(delta);
}
