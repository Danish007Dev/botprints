// ─── Risk Score Storage ─────────────────────────────────────────────────────
// Sorted set for ranked risk scores + dismissed users tracking.
// Uses zRange with reverse to get highest-risk users first.

import { redis } from '@devvit/redis';

const RANKED_KEY = 'bp:scores:ranked';
const DISMISSED_KEY = (u: string): string => `bp:dismissed:${u}`;
const WATCHLIST_KEY = 'bp:scores:watchlist';
const CLEARED_KEY = 'bp:scores:cleared';
const ACTIONED_KEY = 'bp:scores:actioned';

export async function updateUserScore(
  username: string,
  score: number
): Promise<void> {
  await redis.zAdd(RANKED_KEY, { member: username, score });
}

export async function removeUserScore(username: string): Promise<void> {
  await redis.zRem(RANKED_KEY, [username]);
}

/**
 * O(1) lookup of a user's cached risk score from the ranked sorted set.
 * Returns 0 if the user hasn't been scored yet.
 */
export async function getCachedRiskScore(username: string): Promise<number> {
  try {
    const score = await redis.zScore(RANKED_KEY, username);
    return score ?? 0;
  } catch {
    return 0;
  }
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

export async function markUserActioned(username: string): Promise<void> {
  await redis.zAdd(ACTIONED_KEY, { member: username, score: Date.now() });
  await removeUserScore(username);
}

export async function unmarkUserActioned(username: string): Promise<void> {
  await redis.zRem(ACTIONED_KEY, [username]);
}

export async function isUserActioned(username: string): Promise<boolean> {
  try {
    const score = await redis.zScore(ACTIONED_KEY, username);
    return score !== undefined;
  } catch {
    return false;
  }
}

export async function getActionedUsernames(): Promise<string[]> {
  try {
    const results = await redis.zRange(ACTIONED_KEY, 0, -1);
    return results.map((r) => r.member);
  } catch {
    return [];
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
const PENDING_APPEALS_SET = 'bp:appeals:pending';

export async function setAppealStatus(
  username: string,
  status: { status: string; removalReason: string; createdAt: number; expiresAt?: number; username?: string; }
): Promise<void> {
  const fullStatus = { ...status, username };
  await redis.set(APPEAL_KEY(username), JSON.stringify(fullStatus));
  
  if (status.status === 'pending') {
    await redis.zAdd(PENDING_APPEALS_SET, { member: username, score: status.expiresAt || status.createdAt });
  } else {
    await redis.zRem(PENDING_APPEALS_SET, [username]);
  }
}

export async function getAppealStatus(
  username: string
): Promise<{ status: string; removalReason: string; createdAt: number; expiresAt?: number; username: string; } | null> {
  try {
    const raw = await redis.get(APPEAL_KEY(username));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearAppealStatus(username: string): Promise<void> {
  await redis.del(APPEAL_KEY(username));
  await redis.zRem(PENDING_APPEALS_SET, [username]);
}

export async function getAllPendingAppeals(): Promise<Array<{ status: string; removalReason: string; createdAt: number; expiresAt?: number; username: string; }>> {
  try {
    const usernames = await redis.zRange(PENDING_APPEALS_SET, 0, -1);
    if (!usernames || usernames.length === 0) return [];
    
    const results = [];
    for (const u of usernames) {
      const appeal = await getAppealStatus(u.member);
      if (appeal && appeal.status === 'pending') {
        results.push(appeal);
      }
    }
    return results;
  } catch {
    return [];
  }
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
