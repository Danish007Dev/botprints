// ─── Risk Score Aggregation ─────────────────────────────────────────────────
// Combines 5 behavioral signals into a single 0-100 risk score.
// Higher score = more suspicious behavior.
//
// Weight distribution (total = 100):
//   Temporal regularity:  25 pts (inter-arrival CV)
//   Circadian uniformity: 20 pts (Shannon entropy)
//   Engagement ratio:     20 pts (post-to-comment)
//   Edit absence:         15 pts (edit rate)
//   Burst-silence:        20 pts (max gap / median gap) ← NEW

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

  // Signal 3 — Post-to-comment ratio (0-20)
  const engagement =
    ratio === -1 ? 0 : Math.round(20 * ratio);

  // Signal 4 — Edit absence (0-15)
  const editScore =
    editRateVal === -1
      ? 0
      : Math.round(
          15 *
            Math.max(
              0,
              1 - editRateVal / Math.max(baseline.avgEditRate, 0.01)
            )
        );

  // Signal 5 — Burst-silence pattern (0-20)
  const burstSilence =
    burstRatio === -1 ? 0 : Math.round(20 * Math.min(1, burstRatio / 30));

  return {
    temporal,
    circadian,
    engagement,
    editRate: editScore,
    burstSilence,
    total: Math.min(100, temporal + circadian + engagement + editScore + burstSilence),
    hasEnoughData: true,
  };
}
