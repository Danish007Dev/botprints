// ─── Risk Score Aggregation ─────────────────────────────────────────────────
// Combines all 4 behavioral signals into a single 0-100 risk score.
// Higher score = more suspicious behavior.

import {
  computeInterArrivalCV,
  computeCircadianEntropy,
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

  // Score each signal (0 points if insufficient data, i.e. sentinel -1)
  const temporal =
    cv === -1
      ? 0
      : Math.round(
          30 * Math.max(0, 1 - cv / Math.max(baseline.avgInterArrivalCV, 0.1))
        );

  const circadian =
    entropy === -1 ? 0 : Math.round(25 * (entropy / 4.58));

  const engagement =
    ratio === -1 ? 0 : Math.round(25 * ratio);

  const editScore =
    editRateVal === -1
      ? 0
      : Math.round(
          20 *
            Math.max(
              0,
              1 - editRateVal / Math.max(baseline.avgEditRate, 0.01)
            )
        );

  return {
    temporal,
    circadian,
    engagement,
    editRate: editScore,
    total: Math.min(100, temporal + circadian + engagement + editScore),
    hasEnoughData: true,
  };
}
