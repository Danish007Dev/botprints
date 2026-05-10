// ─── Risk Score Storage ─────────────────────────────────────────────────────
// Sorted set for ranked risk scores + dismissed users tracking.
// Uses zRange with reverse to get highest-risk users first.

import { redis } from '@devvit/redis';

const RANKED_KEY = 'bp:scores:ranked';
const DISMISSED_KEY = (u: string): string => `bp:dismissed:${u}`;

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
  await redis.zRem(RANKED_KEY, [username]);
}

export async function isUserDismissed(username: string): Promise<boolean> {
  try {
    return !!(await redis.get(DISMISSED_KEY(username)));
  } catch {
    return false;
  }
}
