// ─── Community Baseline Storage ─────────────────────────────────────────────
// Stores aggregate behavioral statistics for the entire subreddit.
// Used as the reference point to judge individual user anomalies.

import { redis } from '@devvit/redis';
import { DEFAULT_BASELINE } from '../types/index.js';
import type { CommunityBaseline } from '../types/index.js';

const LEGACY_KEY = 'bp:community:baseline';
const KEY = (subredditId?: string): string =>
  subredditId ? `bp:baseline:${subredditId}` : LEGACY_KEY;

export async function getCommunityBaseline(
  subredditId?: string
): Promise<CommunityBaseline> {
  try {
    const raw = await redis.get(KEY(subredditId));
    if (raw) return JSON.parse(raw) as CommunityBaseline;
    if (subredditId) {
      const legacy = await redis.get(LEGACY_KEY);
      return legacy ? (JSON.parse(legacy) as CommunityBaseline) : DEFAULT_BASELINE;
    }
    return DEFAULT_BASELINE;
  } catch {
    return DEFAULT_BASELINE;
  }
}

export async function saveCommunityBaseline(
  baseline: CommunityBaseline,
  subredditId?: string
): Promise<void> {
  await redis.set(KEY(subredditId), JSON.stringify(baseline));
}
