// ─── User Profile Storage ───────────────────────────────────────────────────
// All Redis operations for user profiles and score history.
// Uses @devvit/redis for Devvit 0.12 compatibility.
// NOTE: Devvit Redis does NOT support regular Sets (sAdd/sMembers).
//       We use a sorted set with score=0 to track all usernames.

import { redis } from '@devvit/redis';
import { DEFAULT_PROFILE } from '../types/index.js';
import type { UserProfile } from '../types/index.js';

const KEY = (u: string): string => `bp:user:${u}:profile`;
const HISTORY_KEY = (u: string): string => `bp:user:${u}:scoreHistory`;
const ALL_USERS_KEY = 'bp:users:all'; // sorted set with score=0 for all members

export async function getUserProfile(
  username: string
): Promise<UserProfile> {
  try {
    const raw = await redis.get(KEY(username));
    return raw ? (JSON.parse(raw) as UserProfile) : DEFAULT_PROFILE(username);
  } catch {
    return DEFAULT_PROFILE(username);
  }
}

export async function saveUserProfile(
  username: string,
  profile: UserProfile
): Promise<void> {
  profile.lastUpdated = Date.now();
  await redis.set(KEY(username), JSON.stringify(profile));
}

export async function registerUser(username: string): Promise<void> {
  // Use sorted set with score 0 — Devvit Redis only supports sorted sets, not regular sets
  await redis.zAdd(ALL_USERS_KEY, { member: username, score: 0 });
}

export async function unregisterUser(username: string): Promise<void> {
  await redis.del(KEY(username));
  await redis.del(HISTORY_KEY(username));
  await redis.zRem(ALL_USERS_KEY, [username]);
}

export async function getAllUsernames(): Promise<string[]> {
  try {
    // Retrieve all members from the sorted set (rank 0 to -1 = all)
    const results = await redis.zRange(ALL_USERS_KEY, 0, -1, { by: 'rank' });
    return results.map((r) => r.member);
  } catch {
    return [];
  }
}

export async function getScoreHistory(
  username: string
): Promise<number[]> {
  try {
    const raw = await redis.get(HISTORY_KEY(username));
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

export async function appendScoreHistory(
  username: string,
  score: number
): Promise<void> {
  const history = await getScoreHistory(username);
  history.push(score);
  if (history.length > 14) history.splice(0, history.length - 14);
  await redis.set(HISTORY_KEY(username), JSON.stringify(history));
}
