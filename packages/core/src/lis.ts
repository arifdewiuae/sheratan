// Longest increasing subsequence: the rows that can stay where they are when a
// list is reordered. Everything else moves, which is the minimum number of DOM
// moves for a reordering (SPEC §9 `each`).

/**
 * Indices of a longest increasing run of `sequence`, ignoring negative entries
 * (a row that did not exist before). O(n log n).
 */
export function longestIncreasing(sequence: readonly number[]): number[] {
  const previous: number[] = Array.from({ length: sequence.length }, () => -1);
  const tails: number[] = [];

  for (let index = 0; index < sequence.length; index++) {
    const value = sequence[index] as number;

    if (value < 0) continue;

    let low = 0;
    let high = tails.length;

    while (low < high) {
      const middle = (low + high) >> 1;

      if ((sequence[tails[middle] as number] as number) < value) low = middle + 1;
      else high = middle;
    }

    if (low > 0) previous[index] = tails[low - 1] as number;

    tails[low] = index;
  }

  const result: number[] = [];
  let cursor = tails.length > 0 ? (tails.at(-1) as number) : -1;

  while (cursor >= 0) {
    result.push(cursor);
    cursor = previous[cursor] as number;
  }

  return result.toReversed();
}
