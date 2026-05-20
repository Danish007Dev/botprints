// ─── Demo Data for BotPrints ────────────────────────────────────────────────
// 7 fake accounts with distinct behavioral patterns.
// AutoShill_9000 and CryptoMoonBot share posting windows (coordinated ring).
// EvadeBot_Reborn has a ban evasion match.

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
  // ─── HIGH RISK: Coordinated Bot Ring Member 1 ──────────────────────────
  {
    username: 'AutoShill_9000',
    posts: 47, comments: 3, edits: 0,
    postTimestamps: makeBotTimestamps(SHARED_BASE, 35),
    hourBuckets: makeHourBuckets('uniform'),
    voteScoreDeltas: [5, 5, 6, 5, 5, 6, 5, 5, 5, 6], // suspiciously uniform
    firstSeen: NOW - 7 * DAY,
    lastUpdated: NOW,
  },
  // ─── HIGH RISK: Coordinated Bot Ring Member 2 ──────────────────────────
  {
    username: 'CryptoMoonBot',
    posts: 32, comments: 1, edits: 0,
    postTimestamps: makeBotTimestamps(SHARED_BASE, 20),
    hourBuckets: makeHourBuckets('uniform'),
    voteScoreDeltas: [4, 5, 4, 5, 4, 5, 4, 5], // suspiciously uniform
    firstSeen: NOW - 5 * DAY,
    lastUpdated: NOW,
  },
  // ─── LOW RISK: Genuine Human User ─────────────────────────────────────
  {
    username: 'GenuineUser42',
    posts: 12, comments: 45, edits: 8,
    postTimestamps: makeHumanTimestamps(12),
    hourBuckets: makeHourBuckets('human'),
    voteScoreDeltas: [1, 15, 3, 42, 7, 2, 23, 1], // natural variation
    firstSeen: NOW - 30 * DAY,
    lastUpdated: NOW,
  },
  // ─── MEDIUM RISK: Night-shift bot pattern ─────────────────────────────
  {
    username: 'SleeperAgent_X',
    posts: 25, comments: 20, edits: 2,
    postTimestamps: makeBotTimestamps([], 25),
    hourBuckets: makeHourBuckets('night'),
    voteScoreDeltas: [3, 3, 4, 3, 3, 4, 3, 3, 4], // slightly uniform
    firstSeen: NOW - 14 * DAY,
    lastUpdated: NOW,
  },
  // ─── LOW RISK: Healthy long-time user ─────────────────────────────────
  {
    username: 'HealthyRedditor',
    posts: 8, comments: 67, edits: 15,
    postTimestamps: makeHumanTimestamps(8),
    hourBuckets: makeHourBuckets('human'),
    voteScoreDeltas: [2, 30, 1, 8, 55, 3, 12], // natural variation
    firstSeen: NOW - 60 * DAY,
    lastUpdated: NOW,
  },
  // ─── HIGH RISK: Ban evasion suspect ───────────────────────────────────
  {
    username: 'EvadeBot_Reborn',
    posts: 15, comments: 5, edits: 0,
    postTimestamps: makeBotTimestamps([], 15),
    hourBuckets: makeHourBuckets('uniform'),
    voteScoreDeltas: [6, 6, 7, 6, 6, 7, 6, 6], // suspiciously uniform
    firstSeen: NOW - 3 * DAY,
    lastUpdated: NOW,
    banEvasionMatch: {
      matchedFingerprint: {
        vector: [0.88, 0.90, 0.87, 0.10, 0.80],
        originalUsername: 'BannedSpammer_OG',
        bannedAt: NOW - 30 * DAY,
      },
      similarity: 0.91,
    },
  },
  // ─── MONITORED: New account (insufficient data) ───────────────────────
  {
    username: 'NewUser_2024',
    posts: 2, comments: 3, edits: 0,
    postTimestamps: makeHumanTimestamps(2),
    hourBuckets: makeHourBuckets('human'),
    voteScoreDeltas: [1, 4],
    firstSeen: NOW - 2 * DAY,
    lastUpdated: NOW,
  },
];

// Pre-built demo audit log entries to populate the Audit Log tab
export const DEMO_AUDIT_ENTRIES = [
  {
    timestamp: NOW - 6 * DAY,
    action: 'watch',
    username: 'AutoShill_9000',
    performedBy: 'system',
    details: 'Auto-watched: Suspicion score reached 75/100 during daily analysis.',
  },
  {
    timestamp: NOW - 5 * DAY,
    action: 'filter',
    username: 'CryptoMoonBot',
    performedBy: 'DemoModerator',
    details: 'Tier 1: All future content routed to modqueue for manual review.',
  },
  {
    timestamp: NOW - 4 * DAY,
    action: 'remove-appeal',
    username: 'SleeperAgent_X',
    performedBy: 'DemoModerator',
    details: 'Tier 2: 8 item(s) removed. Appeal instructions sent via modmail.',
  },
  {
    timestamp: NOW - 3 * DAY,
    action: 'ban-report',
    username: 'EvadeBot_Reborn',
    performedBy: 'system',
    details: 'Tier 3: Permanently banned. 12 item(s) reported as spam and removed. Ban evasion match: 91% similarity to u/BannedSpammer_OG.',
  },
  {
    timestamp: NOW - 2 * DAY,
    action: 'dismiss',
    username: 'GenuineUser42',
    performedBy: 'DemoModerator',
    details: 'Manually cleared as safe after review. Behavioral pattern consistent with genuine human.',
  },
];
