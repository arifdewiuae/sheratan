// Pure formatting with no app knowledge. `lib/` may import `lib/` and nothing
// else, which is what keeps it reusable and testable.

const DECIMALS = 1;

/** A sensor reading as it is shown: 21.48 → "21.5 °C". */
export function celsius(reading: number): string {
  return `${reading.toFixed(DECIMALS)} °C`;
}

/** A count with its noun, singular where it should be: 1 → "1 device". */
export function devices(count: number): string {
  return `${String(count)} ${count === 1 ? 'device' : 'devices'}`;
}
