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
// Score contribution: 0-25 points
// score = 25 * (entropy / 4.58)
// Entropy near 4.58 (perfectly uniform) = 25 points (maximum suspicion)

// ─── Test Vectors (for verification) ────────────────────────────────────────
// CV of [0, 900000, 60000, 3600000, 120000] ms gaps → should return > 1.0 (human-like)
// CV of [900000, 901000, 900500, 899000, 900200] ms gaps → should return < 0.01 (bot-like)
// Entropy of hourBuckets all-zero except hours 9-17 → should return < 3.0
// Entropy of hourBuckets perfectly uniform (all equal) → should return ~4.58
