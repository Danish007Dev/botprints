// ─── Temporal Signal Functions ───────────────────────────────────────────────
// Two behavioral signals based on posting time patterns.
// These are pure math functions — no Redis, no Devvit dependencies.

/**
 * Signal 1 — Inter-Arrival Coefficient of Variation
 *
 * Measures regularity of posting speed.
 * Low CV = metronomic = bot-like. High CV = bursty = human-like.
 *
 * @returns 0 (suspicious) to 1+ (authentic), or -1 if insufficient data
 */
export function computeInterArrivalCV(postTimestamps: number[]): number {
  if (postTimestamps.length < 5) return -1; // insufficient data, return sentinel

  const sorted = [...postTimestamps].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((t, i) => t - sorted[i]!);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean === 0) return 0;

  const variance =
    gaps.map((g) => (g - mean) ** 2).reduce((a, b) => a + b, 0) / gaps.length;
  return Math.sqrt(variance) / mean;
}
// Score contribution: 0-30 points
// score = 30 * Math.max(0, 1 - (cv / communityAvgCV))
// If CV < 0.3 and 10+ posts → score approaches 30 (maximum suspicion)

/**
 * Signal 2 — Circadian Entropy (Shannon entropy of posting hour distribution)
 *
 * Low entropy = clusters in waking hours = human.
 * High entropy = uniform across 24h = bot.
 *
 * @returns 0 to 4.58 (log2(24)), or -1 if insufficient data
 */
export function computeCircadianEntropy(hourBuckets: number[]): number {
  const total = hourBuckets.reduce((a, b) => a + b, 0);
  if (total < 5) return -1; // insufficient data

  return -hourBuckets
    .filter((b) => b > 0)
    .map((b) => b / total)
    .reduce((sum, p) => sum + p * Math.log2(p), 0);
}
// Score contribution: 0-20 points
// score = 20 * (entropy / 4.58)

/**
 * Signal 5 — Burst-Silence Ratio (Pozzana & Ferrara, 2020)
 *
 * Bots post in batches then go silent (batch scheduler pattern).
 * Humans have irregular but continuous activity.
 * Ratio = max_gap / median_gap
 *
 * @returns ratio (high = suspicious burst-silence pattern), or -1 if insufficient data
 */
export function computeBurstSilenceRatio(postTimestamps: number[]): number {
  if (postTimestamps.length < 8) return -1; // need more data for meaningful gaps

  const sorted = [...postTimestamps].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((t, i) => t - sorted[i]!);

  // Median gap
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sortedGaps.length / 2);
  const median =
    sortedGaps.length % 2 === 0
      ? (sortedGaps[mid - 1]! + sortedGaps[mid]!) / 2
      : sortedGaps[mid]!;

  if (median === 0) return 0;
  const maxGap = sortedGaps[sortedGaps.length - 1]!;
  return maxGap / median;
}
// Score contribution: 0-20 points
// Humans: ratio < 5 (some variation, never extreme)
// Bots: ratio > 20 (15-min burst, 24-hour silence, repeat)
// score = 20 * Math.min(1, ratio / 30)
