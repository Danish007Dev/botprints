// ─── Risk Score Storage ─────────────────────────────────────────────────────
// Sorted set for ranked risk scores + dismissed users tracking.
// Uses zRange with reverse to get highest-risk users first.

import { redis } from '@devvit/redis';

const RANKED_KEY = 'bp:scores:ranked';
const DISMISSED_KEY = (u: string): string => `bp:dismissed:${u}`;
const WATCHLIST_KEY = 'bp:scores:watchlist';
const CLEARED_KEY = 'bp:scores:cleared';

export async function updateUserScore(
  username: string,
  score: number
): Promise<void> {
  await redis.zAdd(RANKED_KEY, { member: username, score });
}

export async function getTopRiskyUsers(
  count: number = 20
): Promise<{ username: string; score: number }[]> {
  try {
    // zRange with by: 'rank' and reverse: true gives highest scores first
    // rank 0 to count-1 in reverse = top N highest scores
    const results = await redis.zRange(RANKED_KEY, 0, count - 1, {
      by: 'rank',
      reverse: true,
    });
    return results.map((r) => ({ username: r.member, score: r.score }));
  } catch {
    return [];
  }
}

export async function dismissUser(username: string): Promise<void> {
  await redis.set(DISMISSED_KEY(username), '1');
  await redis.zAdd(CLEARED_KEY, { member: username, score: Date.now() });
  await redis.zRem(RANKED_KEY, [username]);
  await removeFromWatchlist(username);
}

export async function undismissUser(username: string): Promise<void> {
  await redis.del(DISMISSED_KEY(username));
  await redis.zRem(CLEARED_KEY, [username]);
}

export async function getClearedUsernames(): Promise<string[]> {
  try {
    const results = await redis.zRange(CLEARED_KEY, 0, 49, {
      by: 'rank',
      reverse: true,
    });
    return results.map((r) => r.member);
  } catch {
    return [];
  }
}

export async function isUserDismissed(username: string): Promise<boolean> {
  try {
    const isDismissed = !!(await redis.get(DISMISSED_KEY(username)));
    if (isDismissed) {
      // Auto-migrate legacy dismissed users to the cleared set so they appear in the Safe tab
      const score = await redis.zScore(CLEARED_KEY, username);
      if (score === undefined) {
        await redis.zAdd(CLEARED_KEY, { member: username, score: Date.now() });
      }
    }
    return isDismissed;
  } catch {
    return false;
  }
}

export async function addToWatchlist(username: string): Promise<void> {
  await redis.zAdd(WATCHLIST_KEY, { member: username, score: Date.now() });
}

export async function removeFromWatchlist(username: string): Promise<void> {
  await redis.zRem(WATCHLIST_KEY, [username]);
}

export async function isUserWatched(username: string): Promise<boolean> {
  try {
    const score = await redis.zScore(WATCHLIST_KEY, username);
    return score !== undefined;
  } catch {
    return false;
  }
}

// ─── Filter List (Tier 1: modqueue routing) ─────────────────────────────────
const FILTER_KEY = 'bp:scores:filtered';

export async function addToFilterList(username: string): Promise<void> {
  await redis.zAdd(FILTER_KEY, { member: username, score: Date.now() });
}

export async function removeFromFilterList(username: string): Promise<void> {
  await redis.zRem(FILTER_KEY, [username]);
}

export async function isUserFiltered(username: string): Promise<boolean> {
  try {
    const score = await redis.zScore(FILTER_KEY, username);
    return score !== undefined;
  } catch {
    return false;
  }
}

// ─── Appeal Status (Tier 2: remove + appeal) ────────────────────────────────
const APPEAL_KEY = (u: string): string => `bp:appeal:${u}`;

export async function setAppealStatus(
  username: string,
  status: { status: string; removalReason: string; createdAt: number }
): Promise<void> {
  await redis.set(APPEAL_KEY(username), JSON.stringify(status));
}

export async function getAppealStatus(
  username: string
): Promise<{ status: string; removalReason: string; createdAt: number } | null> {
  try {
    const raw = await redis.get(APPEAL_KEY(username));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearAppealStatus(username: string): Promise<void> {
  await redis.del(APPEAL_KEY(username));
}

// ─── Audit Trail ────────────────────────────────────────────────────────────
const AUDIT_KEY = 'bp:audit:log';

export async function appendAuditEntry(entry: {
  timestamp: number;
  action: string;
  username: string;
  performedBy: string;
  details: string;
}): Promise<void> {
  // Store as JSON string in a sorted set keyed by timestamp
  await redis.zAdd(AUDIT_KEY, {
    member: JSON.stringify(entry),
    score: entry.timestamp,
  });
}

export async function getAuditLog(
  count: number = 50
): Promise<Array<{ timestamp: number; action: string; username: string; performedBy: string; details: string }>> {
  try {
    const results = await redis.zRange(AUDIT_KEY, 0, count - 1, {
      by: 'rank',
      reverse: true,
    });
    return results.map((r) => JSON.parse(r.member));
  } catch {
    return [];
  }
}
