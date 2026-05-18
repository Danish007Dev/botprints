// ─── Auto-Action Settings Storage ───────────────────────────────────────────
// Centralized subreddit-level configuration for the auto-action engine.
// Stored as a single JSON blob in Redis.
//
// Key: bp:settings:autoaction — JSON string of AutoActionSettings

import { redis } from '@devvit/redis';
import type { AutoActionSettings } from '../types/index.js';
import { DEFAULT_AUTO_ACTION_SETTINGS } from '../types/index.js';

const SETTINGS_KEY = 'bp:settings:autoaction';

/**
 * Load the current auto-action settings. Returns defaults if none saved.
 */
export async function getAutoActionSettings(): Promise<AutoActionSettings> {
  try {
    const raw = await redis.get(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults to ensure new fields added in updates are present
      return { ...DEFAULT_AUTO_ACTION_SETTINGS, ...parsed };
    }
  } catch { /* use defaults */ }
  return { ...DEFAULT_AUTO_ACTION_SETTINGS };
}

/**
 * Save auto-action settings with validation and clamping.
 */
export async function saveAutoActionSettings(
  settings: Partial<AutoActionSettings>
): Promise<AutoActionSettings> {
  const current = await getAutoActionSettings();
  const merged = { ...current, ...settings };

  // Clamp numeric values to valid ranges
  merged.lowRiskCutoff = clamp(merged.lowRiskCutoff, 30, 80);
  merged.mediumRiskCutoff = clamp(merged.mediumRiskCutoff, 50, 95);
  merged.highRiskCutoff = clamp(merged.highRiskCutoff, 70, 100);
  merged.newAccountThresholdDays = clamp(merged.newAccountThresholdDays, 7, 90);
  merged.newAccountMultiplier = clamp(merged.newAccountMultiplier, 1.1, 2.0);
  merged.dailyAnalysisHour = clamp(Math.round(merged.dailyAnalysisHour), 0, 23);

  // Ensure threshold order: low < medium < high
  if (merged.mediumRiskCutoff <= merged.lowRiskCutoff) {
    merged.mediumRiskCutoff = merged.lowRiskCutoff + 5;
  }
  if (merged.highRiskCutoff <= merged.mediumRiskCutoff) {
    merged.highRiskCutoff = merged.mediumRiskCutoff + 5;
  }

  // Validate enum values
  const validActions = ['nothing', 'modqueue', 'remove-appeal', 'ban-report'];
  if (!validActions.includes(merged.lowRiskAction)) merged.lowRiskAction = 'nothing';
  if (!validActions.includes(merged.mediumRiskAction)) merged.mediumRiskAction = 'nothing';
  if (!validActions.includes(merged.highRiskAction)) merged.highRiskAction = 'nothing';

  const validTimeouts = ['24h', '48h', '72h', 'never'];
  if (!validTimeouts.includes(merged.appealTimeout)) merged.appealTimeout = 'never';

  await redis.set(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}
