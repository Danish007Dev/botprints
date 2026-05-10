// ─── Behavioral Shift Detector ──────────────────────────────────────────────
// THE FRONTIER SIGNAL — from arXiv 2025 "Behavior Change as a Signal"
// Detects warmed-up accounts switching to shill/spam mode.
// Compares today's score to own 7-day historical baseline.

import type { ShiftResult } from '../types/index.js';

export function detectBehavioralShift(scoreHistory: number[]): ShiftResult {
  if (scoreHistory.length < 7) {
    return {
      shifted: false,
      magnitude: 0,
      direction: 'stable',
      daysSinceNormal: 0,
    };
  }

  const window = scoreHistory.slice(-7);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const variance =
    window.map((s) => (s - mean) ** 2).reduce((a, b) => a + b, 0) /
    window.length;
  const std = Math.sqrt(variance);
  const today = scoreHistory[scoreHistory.length - 1]!;
  const zScore = std === 0 ? 0 : (today - mean) / std;
  const daysSinceNormal = scoreHistory
    .slice(-14)
    .filter((s) => s > 60).length;

  return {
    shifted: zScore > 2.0,
    magnitude: Math.min(5, Math.round(zScore * 10) / 10),
    direction: today > mean ? 'rising' : 'stable',
    daysSinceNormal,
  };
}
