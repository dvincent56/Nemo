export function bandFor(value: number, thresholds: readonly number[]): number {
  let band = 0;
  for (const t of thresholds) {
    if (value >= t) band++;
    else break;
  }
  return band;
}
