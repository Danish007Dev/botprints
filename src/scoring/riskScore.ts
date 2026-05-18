// ─── Risk Score Aggregation ─────────────────────────────────────────────────
// Combines 6 behavioral signals into a single 0-100 risk score.
// Higher score = more suspicious behavior.
//
// Weight distribution (total = 100):
//   Temporal regularity:  25 pts (inter-arrival CV)
//   Circadian uniformity: 20 pts (Shannon entropy)
//   Engagement ratio:     15 pts (post-to-comment)
//   Edit absence:         10 pts (edit rate)
//   Burst-silence:        15 pts (max gap / median gap)
//   Vote correlation:     15 pts (vote timing patterns)

import {
  computeInterArrivalCV,
  computeCircadianEntropy,
  computeBurstSilenceRatio,
} from '../signals/temporal.js';
import {
  computePostCommentRatio,
  computeEditRate,
} from '../signals/engagement.js';
import type {
  UserProfile,
  CommunityBaseline,
  ScoreBreakdown,
} from '../types/index.js';

/**
 * Compute vote correlation signal from post score deltas.
 * If multiple posts spike in score within similar windows, it indicates
 * coordinated upvoting (astroturfing rings).
 * Returns 0-1 normalized value.
 */
function computeVoteCorrelation(voteScoreDeltas: number[]): number {
  if (!voteScoreDeltas || voteScoreDeltas.length < 3) return 0;

  // Check for suspiciously uniform vote patterns
  const avg = voteScoreDeltas.reduce((s, v) => s + v, 0) / voteScoreDeltas.length;
  if (avg === 0) return 0;

  // Coefficient of variation — low CV means uniform upvote patterns (suspicious)
  const variance = voteScoreDeltas.reduce((s, v) => s + (v - avg) ** 2, 0) / voteScoreDeltas.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / Math.abs(avg);

  // Very low CV (< 0.3) means unnaturally uniform vote scores — suspicious
  // High CV (> 1.0) means organic variation — normal
  if (cv > 1.0) return 0;
  return Math.max(0, 1 - cv / 1.0);
}

export function computeRiskScore(
  profile: UserProfile,
  baseline: CommunityBaseline,
  minPosts: number = 5
): ScoreBreakdown {
  if (profile.posts < minPosts) {
    return {
      temporal: 0,
      circadian: 0,
      engagement: 0,
      editRate: 0,
      burstSilence: 0,
      voteCorrelation: 0,
      total: 0,
      hasEnoughData: false,
    };
  }

  const cv = computeInterArrivalCV(profile.postTimestamps);
  const entropy = computeCircadianEntropy(profile.hourBuckets);
  const ratio = computePostCommentRatio(profile.posts, profile.comments);
  const editRateVal = computeEditRate(
    profile.edits,
    profile.posts,
    profile.comments
  );
  const burstRatio = computeBurstSilenceRatio(profile.postTimestamps);
  const voteCorr = computeVoteCorrelation(profile.voteScoreDeltas || []);

  // Signal 1 — Temporal regularity (0-25)
  const temporal =
    cv === -1
      ? 0
      : Math.round(
          25 * Math.max(0, 1 - cv / Math.max(baseline.avgInterArrivalCV, 0.1))
        );

  // Signal 2 — Circadian uniformity (0-20)
  const circadian =
    entropy === -1 ? 0 : Math.round(20 * (entropy / 4.58));

  // Signal 3 — Post-to-comment ratio (0-15)
  const engagement =
    ratio === -1 ? 0 : Math.round(15 * ratio);

  // Signal 4 — Edit absence (0-10)
  const editScore =
    editRateVal === -1
      ? 0
      : Math.round(
          10 *
            Math.max(
              0,
              1 - editRateVal / Math.max(baseline.avgEditRate, 0.01)
            )
        );

  // Signal 5 — Burst-silence pattern (0-15)
  const burstSilence =
    burstRatio === -1 ? 0 : Math.round(15 * Math.min(1, burstRatio / 30));

  // Signal 6 — Vote correlation (0-15)
  const voteCorrelation = Math.round(15 * voteCorr);

  return {
    temporal,
    circadian,
    engagement,
    editRate: editScore,
    burstSilence,
    voteCorrelation,
    total: Math.min(100, temporal + circadian + engagement + editScore + burstSilence + voteCorrelation),
    hasEnoughData: true,
  };
}
