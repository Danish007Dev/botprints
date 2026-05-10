// ─── Engagement Signal Functions ────────────────────────────────────────────
// Two behavioral signals based on user interaction patterns.
// These are pure math functions — no Redis, no Devvit dependencies.

/**
 * Signal 3 — Post-to-Comment Ratio
 *
 * Authentic users comment more than they post (social reciprocity theory).
 * Karma farmers post constantly without engaging.
 *
 * @returns 0.0 (all comments) to 1.0 (all posts), or -1 if insufficient data
 */
export function computePostCommentRatio(
  posts: number,
  comments: number
): number {
  const total = posts + comments;
  if (total < 5) return -1; // insufficient data
  return posts / total;
}
// Score contribution: 0-25 points
// score = 25 * ratio
// Ratio = 1.0 (zero comments) = 25 points (maximum suspicion)

/**
 * Signal 4 — Edit Rate
 *
 * AI-generated content is almost never edited (computed before posting).
 * Humans fix typos, add context, correct themselves.
 *
 * @returns 0.0 (never edits) to 1.0+ (frequent editor), or -1 if insufficient data
 */
export function computeEditRate(
  edits: number,
  posts: number,
  comments: number
): number {
  const total = posts + comments;
  if (total < 5) return -1; // insufficient data
  return edits / total;
}
// Score contribution: 0-20 points
// score = 20 * Math.max(0, 1 - (editRate / communityAvgEditRate))
// EditRate near 0 = 20 points (maximum suspicion)
