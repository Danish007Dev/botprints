// ─── Community Baseline Storage ─────────────────────────────────────────────
// Stores aggregate behavioral statistics for the entire subreddit.
// Used as the reference point to judge individual user anomalies.

import { redis } from '@devvit/redis';
import { DEFAULT_BASELINE } from '../types/index.js';
import type { CommunityBaseline } from '../types/index.js';

const KEY = 'bp:community:baseline';

export async function getCommunityBaseline(): Promise<CommunityBaseline> {
  try {
    const raw = await redis.get(KEY);
    return raw ? (JSON.parse(raw) as CommunityBaseline) : DEFAULT_BASELINE;
  } catch {
    return DEFAULT_BASELINE;
  }
}

export async function saveCommunityBaseline(
  baseline: CommunityBaseline
): Promise<void> {
  await redis.set(KEY, JSON.stringify(baseline));
}
