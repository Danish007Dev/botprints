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

export const MIN_ACTIVITY_FOR_SIGNALS = 10;
export const MIN_ACTIVITY_FOR_SCORE = 25;
export const MIN_BASELINE_SAMPLE = 50;
export const MIN_BASELINE_DAYS = 30;
export const ELEVATION_ZSCORE = 1.5;

const SIGNAL_MAX = {
  temporal: 25,
  circadian: 20,
  engagement: 15,
  editRate: 10,
  burstSilence: 15,
  voteCorrelation: 15,
};

const ELEVATION_RATIO = 0.6;
const DAY_MS = 24 * 60 * 60 * 1000;

function isCommunityBaselineReady(baseline: CommunityBaseline): boolean {
  if (!baseline.signalMeans || !baseline.signalStdDevs) return false;
  const sampleSize = baseline.signalSampleSize ?? 0;
  if (sampleSize < MIN_BASELINE_SAMPLE) return false;
  const startedAt = baseline.signalBaselineStartedAt ?? 0;
  if (!startedAt) return false;
  const days = (Date.now() - startedAt) / DAY_MS;
  return days >= MIN_BASELINE_DAYS;
}

function zScore(value: number, mean?: number, stdDev?: number): number {
  if (mean === undefined || stdDev === undefined || stdDev <= 0) return 0;
  return (value - mean) / stdDev;
}

function countElevatedSignals(scores: {
  temporal: number;
  circadian: number;
  engagement: number;
  editRate: number;
  burstSilence: number;
  voteCorrelation: number;
}, baseline: CommunityBaseline): number {
  let count = 0;

  if (isCommunityBaselineReady(baseline)) {
    const means = baseline.signalMeans;
    const stds = baseline.signalStdDevs;

    if (zScore(scores.temporal, means?.temporal, stds?.temporal) >= ELEVATION_ZSCORE) count++;
    if (zScore(scores.circadian, means?.circadian, stds?.circadian) >= ELEVATION_ZSCORE) count++;
    if (zScore(scores.engagement, means?.engagement, stds?.engagement) >= ELEVATION_ZSCORE) count++;
    if (zScore(scores.editRate, means?.editRate, stds?.editRate) >= ELEVATION_ZSCORE) count++;
    if (zScore(scores.burstSilence, means?.burstSilence, stds?.burstSilence) >= ELEVATION_ZSCORE) count++;
    if (zScore(scores.voteCorrelation, means?.voteCorrelation, stds?.voteCorrelation) >= ELEVATION_ZSCORE) count++;
    return count;
  }

  const thresholds = {
    temporal: Math.ceil(SIGNAL_MAX.temporal * ELEVATION_RATIO),
    circadian: Math.ceil(SIGNAL_MAX.circadian * ELEVATION_RATIO),
    engagement: Math.ceil(SIGNAL_MAX.engagement * ELEVATION_RATIO),
    editRate: Math.ceil(SIGNAL_MAX.editRate * ELEVATION_RATIO),
    burstSilence: Math.ceil(SIGNAL_MAX.burstSilence * ELEVATION_RATIO),
    voteCorrelation: Math.ceil(SIGNAL_MAX.voteCorrelation * ELEVATION_RATIO),
  };

  if (scores.temporal >= thresholds.temporal) count++;
  if (scores.circadian >= thresholds.circadian) count++;
  if (scores.engagement >= thresholds.engagement) count++;
  if (scores.editRate >= thresholds.editRate) count++;
  if (scores.burstSilence >= thresholds.burstSilence) count++;
  if (scores.voteCorrelation >= thresholds.voteCorrelation) count++;

  return count;
}

function applyCoOccurrenceGate(rawTotal: number, elevationCount: number): number {
  if (elevationCount <= 1) return Math.min(rawTotal, 35);
  if (elevationCount === 2) return Math.min(rawTotal, 55);
  return rawTotal;
}

export interface RiskScoreOptions {
  allowLowSignal?: boolean; // allow signal computation below the minimum activity threshold
}

export function computeRiskScore(
  profile: UserProfile,
  baseline: CommunityBaseline,
  options: RiskScoreOptions = {}
): ScoreBreakdown {
  const activityCount = (profile.posts || 0) + (profile.comments || 0);

  if (activityCount < MIN_ACTIVITY_FOR_SIGNALS && !options.allowLowSignal) {
    return {
      temporal: 0,
      circadian: 0,
      engagement: 0,
      editRate: 0,
      burstSilence: 0,
      voteCorrelation: 0,
      elevationCount: 0,
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

  const rawTotal = Math.min(
    100,
    temporal + circadian + engagement + editScore + burstSilence + voteCorrelation
  );
  const elevationCount = countElevatedSignals({
    temporal,
    circadian,
    engagement,
    editRate: editScore,
    burstSilence,
    voteCorrelation,
  }, baseline);
  const total =
    activityCount >= MIN_ACTIVITY_FOR_SCORE
      ? applyCoOccurrenceGate(rawTotal, elevationCount)
      : 0;

  return {
    temporal,
    circadian,
    engagement,
    editRate: editScore,
    burstSilence,
    voteCorrelation,
    elevationCount,
    total,
    hasEnoughData: activityCount >= MIN_ACTIVITY_FOR_SCORE,
  };
}
