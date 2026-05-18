// ─── Demo Data for BotPrints ────────────────────────────────────────────────
// 5 fake accounts with distinct behavioral patterns.
// AutoShill_9000 and CryptoMoonBot share posting windows (coordinated ring).

import type { UserProfile } from '../types/index.js';

const NOW = Date.now();
const HOUR = 3600000;
const DAY = 86400000;

// Shared base timestamps for the coordinated pair — same 5-min windows
const SHARED_BASE = [
  NOW - 6 * DAY + 2 * HOUR,
  NOW - 6 * DAY + 2 * HOUR + 180000,
  NOW - 5 * DAY + 14 * HOUR,
  NOW - 5 * DAY + 14 * HOUR + 120000,
  NOW - 4 * DAY + 8 * HOUR,
  NOW - 4 * DAY + 8 * HOUR + 90000,
  NOW - 3 * DAY + 20 * HOUR,
  NOW - 3 * DAY + 20 * HOUR + 200000,
  NOW - 2 * DAY + 5 * HOUR,
  NOW - 2 * DAY + 5 * HOUR + 150000,
  NOW - 1 * DAY + 11 * HOUR,
  NOW - 1 * DAY + 11 * HOUR + 60000,
];

function makeBotTimestamps(base: number[], extra: number): number[] {
  const ts = [...base];
  for (let i = 0; i < extra; i++) {
    ts.push(NOW - Math.floor(Math.random() * 7 * DAY) + Math.floor(Math.random() * 300000));
  }
  return ts.sort((a, b) => a - b);
}

function makeHumanTimestamps(count: number): number[] {
  return Array.from({ length: count }, () =>
    NOW - Math.floor(Math.random() * 30 * DAY)
  ).sort((a, b) => a - b);
}

function makeHourBuckets(pattern: 'uniform' | 'human' | 'night'): number[] {
  const b = new Array<number>(24).fill(0);
  if (pattern === 'uniform') for (let i = 0; i < 24; i++) b[i] = 4;
  else if (pattern === 'human') for (let i = 8; i <= 22; i++) b[i] = 3 + (i % 3);
  else { for (let i = 0; i < 24; i++) b[i] = 2; for (let i = 1; i <= 5; i++) b[i] = 9; }
  return b;
}

export const DEMO_PROFILES: UserProfile[] = [
  {
    username: 'AutoShill_9000',
    posts: 47, comments: 3, edits: 0,
    postTimestamps: makeBotTimestamps(SHARED_BASE, 35),
    hourBuckets: makeHourBuckets('uniform'),
    voteScoreDeltas: [5, 5, 6, 5, 5, 6, 5, 5, 5, 6], // suspiciously uniform
    firstSeen: NOW - 7 * DAY,
    lastUpdated: NOW,
  },
  {
    username: 'CryptoMoonBot',
    posts: 32, comments: 1, edits: 0,
    postTimestamps: makeBotTimestamps(SHARED_BASE, 20),
    hourBuckets: makeHourBuckets('uniform'),
    voteScoreDeltas: [4, 5, 4, 5, 4, 5, 4, 5], // suspiciously uniform
    firstSeen: NOW - 5 * DAY,
    lastUpdated: NOW,
  },
  {
    username: 'GenuineUser42',
    posts: 12, comments: 45, edits: 8,
    postTimestamps: makeHumanTimestamps(12),
    hourBuckets: makeHourBuckets('human'),
    voteScoreDeltas: [1, 15, 3, 42, 7, 2, 23, 1], // natural variation
    firstSeen: NOW - 30 * DAY,
    lastUpdated: NOW,
  },
  {
    username: 'SleeperAgent_X',
    posts: 25, comments: 20, edits: 2,
    postTimestamps: makeBotTimestamps([], 25),
    hourBuckets: makeHourBuckets('night'),
    voteScoreDeltas: [3, 3, 4, 3, 3, 4, 3, 3, 4], // slightly uniform
    firstSeen: NOW - 14 * DAY,
    lastUpdated: NOW,
  },
  {
    username: 'HealthyRedditor',
    posts: 8, comments: 67, edits: 15,
    postTimestamps: makeHumanTimestamps(8),
    hourBuckets: makeHourBuckets('human'),
    voteScoreDeltas: [2, 30, 1, 8, 55, 3, 12], // natural variation
    firstSeen: NOW - 60 * DAY,
    lastUpdated: NOW,
  },
];
