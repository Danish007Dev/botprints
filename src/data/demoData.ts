// ─── Demo Data for BotPrints ────────────────────────────────────────────────
// 5 fake accounts with varying risk profiles for judges to see.

import type { UserProfile } from '../types/index.js';

function makeTimestamps(count: number, intervalMs: number, jitterMs: number): number[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) =>
    now - (count - i) * intervalMs + Math.floor(Math.random() * jitterMs)
  );
}

function makeHourBuckets(pattern: 'uniform' | 'human' | 'night'): number[] {
  const b = new Array<number>(24).fill(0);
  if (pattern === 'uniform') {
    for (let i = 0; i < 24; i++) b[i] = 4 + Math.floor(Math.random() * 2);
  } else if (pattern === 'human') {
    for (let i = 8; i <= 22; i++) b[i] = 3 + Math.floor(Math.random() * 5);
  } else {
    for (let i = 0; i < 24; i++) b[i] = 2 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= 5; i++) b[i] = 8 + Math.floor(Math.random() * 4);
  }
  return b;
}

export const DEMO_PROFILES: UserProfile[] = [
  {
    username: 'AutoShill_9000',
    posts: 47, comments: 3, edits: 0,
    postTimestamps: makeTimestamps(47, 900000, 5000),
    hourBuckets: makeHourBuckets('uniform'),
    firstSeen: Date.now() - 7 * 86400000,
    lastUpdated: Date.now(),
  },
  {
    username: 'CryptoMoonBot',
    posts: 32, comments: 1, edits: 0,
    postTimestamps: makeTimestamps(32, 1800000, 3000),
    hourBuckets: makeHourBuckets('uniform'),
    firstSeen: Date.now() - 5 * 86400000,
    lastUpdated: Date.now(),
  },
  {
    username: 'GenuineUser42',
    posts: 12, comments: 45, edits: 8,
    postTimestamps: makeTimestamps(12, 14400000, 7200000),
    hourBuckets: makeHourBuckets('human'),
    firstSeen: Date.now() - 30 * 86400000,
    lastUpdated: Date.now(),
  },
  {
    username: 'SleeperAgent_X',
    posts: 25, comments: 20, edits: 2,
    postTimestamps: makeTimestamps(25, 3600000, 60000),
    hourBuckets: makeHourBuckets('night'),
    firstSeen: Date.now() - 14 * 86400000,
    lastUpdated: Date.now(),
  },
  {
    username: 'HealthyRedditor',
    posts: 8, comments: 67, edits: 15,
    postTimestamps: makeTimestamps(8, 43200000, 10800000),
    hourBuckets: makeHourBuckets('human'),
    firstSeen: Date.now() - 60 * 86400000,
    lastUpdated: Date.now(),
  },
];
