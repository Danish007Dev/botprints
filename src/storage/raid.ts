// ─── Raid Detection Storage ─────────────────────────────────────────────────
// Sliding window counter using Redis sorted sets.
// O(1) check on every trigger: count distinct high-risk users posting within window.
//
// Keys:
//   bp:raid:window     — sorted set: member=username, score=timestamp (ms)
//   bp:raid:cooldown   — string: timestamp when cooldown ends (2h after alert)
//   bp:raid:state      — JSON string: current RaidState for dashboard banner
//   bp:settings:raid   — JSON string: configurable thresholds

import { redis } from '@devvit/redis';
import type { RaidSettings, RaidState, RaidParticipant } from '../types/index.js';
import { DEFAULT_RAID_SETTINGS } from '../types/index.js';

const RAID_WINDOW_KEY = 'bp:raid:window';
const RAID_COOLDOWN_KEY = 'bp:raid:cooldown';
const RAID_STATE_KEY = 'bp:raid:state';
const RAID_SETTINGS_KEY = 'bp:settings:raid';

const COOLDOWN_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─── Settings ───────────────────────────────────────────────────────────────

export async function getRaidSettings(): Promise<RaidSettings> {
  try {
    const raw = await redis.get(RAID_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_RAID_SETTINGS, ...parsed };
    }
  } catch { /* use defaults */ }
  return { ...DEFAULT_RAID_SETTINGS };
}

export async function saveRaidSettings(settings: RaidSettings): Promise<void> {
  // Clamp values to valid ranges
  const clamped: RaidSettings = {
    triggerThreshold: Math.min(10, Math.max(3, settings.triggerThreshold)),
    triggerWindowMinutes: Math.min(30, Math.max(5, settings.triggerWindowMinutes)),
    minScoreForRaid: Math.min(80, Math.max(40, settings.minScoreForRaid)),
  };
  await redis.set(RAID_SETTINGS_KEY, JSON.stringify(clamped));
}

// ─── Sliding Window ─────────────────────────────────────────────────────────

/**
 * Record a high-risk user's activity in the sliding window.
 * Called from triggers when a user with cached score >= threshold posts/comments.
 */
export async function recordRaidActivity(username: string, score: number): Promise<void> {
  const now = Date.now();
  // ZADD with username as member, timestamp as score
  // If user already exists, their timestamp is updated (they only count once)
  await redis.zAdd(RAID_WINDOW_KEY, { member: `${username}:${score}`, score: now });
}

/**
 * Check if raid conditions are met. O(1) amortized.
 * Returns the list of participants if threshold is met, null otherwise.
 */
export async function checkRaidCondition(): Promise<RaidParticipant[] | null> {
  const settings = await getRaidSettings();
  const now = Date.now();
  const windowMs = settings.triggerWindowMinutes * 60 * 1000;
  const cutoff = now - windowMs;

  // Prune entries older than the window
  await redis.zRemRangeByScore(RAID_WINDOW_KEY, 0, cutoff);

  // Count distinct users in the window
  const entries = await redis.zRange(RAID_WINDOW_KEY, 0, -1, { by: 'rank' });

  if (entries.length < settings.triggerThreshold) {
    return null;
  }

  // Parse participants — deduplicate by username (take latest)
  const userMap = new Map<string, RaidParticipant>();
  for (const entry of entries) {
    const parts = entry.member.split(':');
    const score = parseInt(parts.pop() || '0', 10);
    const username = parts.join(':'); // handle usernames with colons
    userMap.set(username, {
      username,
      score,
      lastPostTimestamp: entry.score,
    });
  }

  const participants = Array.from(userMap.values());
  if (participants.length < settings.triggerThreshold) {
    return null;
  }

  // Sort by score descending
  participants.sort((a, b) => b.score - a.score);
  return participants;
}

// ─── Cooldown ───────────────────────────────────────────────────────────────

/**
 * Check if we're in a cooldown period (don't fire duplicate alerts).
 */
export async function isRaidCooldownActive(): Promise<boolean> {
  try {
    const raw = await redis.get(RAID_COOLDOWN_KEY);
    if (!raw) return false;
    return Date.now() < parseInt(raw, 10);
  } catch {
    return false;
  }
}

/**
 * Set a 2-hour cooldown after firing a raid alert.
 */
export async function setRaidCooldown(): Promise<void> {
  const cooldownEnds = Date.now() + COOLDOWN_DURATION_MS;
  await redis.set(RAID_COOLDOWN_KEY, String(cooldownEnds));
}

// ─── Raid State (for dashboard banner) ──────────────────────────────────────

/**
 * Save the current raid state so the dashboard can display a banner.
 */
export async function setRaidState(state: RaidState): Promise<void> {
  await redis.set(RAID_STATE_KEY, JSON.stringify(state));
}

/**
 * Get the current raid state. Returns null if no raid is active.
 */
export async function getRaidState(): Promise<RaidState | null> {
  try {
    const raw = await redis.get(RAID_STATE_KEY);
    if (!raw) return null;
    const state: RaidState = JSON.parse(raw);
    // If cooldown has ended, clear the raid state
    if (state.cooldownEndsAt && Date.now() > state.cooldownEndsAt) {
      await clearRaidState();
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

/**
 * Clear the raid state (raid is over).
 */
export async function clearRaidState(): Promise<void> {
  await redis.del(RAID_STATE_KEY);
}
