// ─── BotPrints Type Definitions ─────────────────────────────────────────────
// Single source of truth for all data structures used across the app.
// This file is imported by storage, signals, scoring, triggers, and UI layers.

export interface UserProfile {
  username: string;
  posts: number;
  comments: number;
  edits: number;
  postTimestamps: number[]; // max 50, Unix ms
  hourBuckets: number[]; // always length 24
  firstSeen: number;
  lastUpdated: number;
}

export interface CommunityBaseline {
  avgInterArrivalCV: number;
  avgCircadianEntropy: number;
  avgPostCommentRatio: number;
  avgEditRate: number;
  sampleSize: number;
  lastComputed: number;
}

export const DEFAULT_PROFILE = (username: string): UserProfile => ({
  username,
  posts: 0,
  comments: 0,
  edits: 0,
  postTimestamps: [],
  hourBuckets: new Array<number>(24).fill(0),
  firstSeen: Date.now(),
  lastUpdated: Date.now(),
});

export const DEFAULT_BASELINE: CommunityBaseline = {
  avgInterArrivalCV: 1.2, // assume moderately bursty community
  avgCircadianEntropy: 2.8, // assume waking-hours cluster
  avgPostCommentRatio: 0.35, // assume more comments than posts
  avgEditRate: 0.08, // assume occasional editing
  sampleSize: 0,
  lastComputed: 0,
};

export interface ScoreBreakdown {
  temporal: number; // 0-25
  circadian: number; // 0-20
  engagement: number; // 0-20
  editRate: number; // 0-15
  burstSilence: number; // 0-20 — NEW: burst-silence pattern
  total: number; // 0-100
  hasEnoughData: boolean;
}

export interface ShiftResult {
  shifted: boolean;
  magnitude: number; // z-score, max 5.0
  direction: 'rising' | 'stable';
  daysSinceNormal: number;
}

export interface ScoredUser {
  username: string;
  score: number;
  breakdown: ScoreBreakdown;
  shift: ShiftResult;
  profile: UserProfile;
  coordGroup?: string; // group ID if part of a coordinated ring
  isWatched?: boolean;
  isCleared?: boolean;
}

export interface CoordinatedGroup {
  id: string;
  members: string[]; // usernames
  avgCorrelation: number; // 0-1
  sharedWindows: number; // how many 5-min windows overlap
}

export interface SubredditSummary {
  totalTracked: number;
  highRiskCount: number;
  shiftedCount: number;
  coordGroupCount: number;
  healthScore: number; // 100 - avg risk of top 20 (higher = healthier)
  lastScan: number;
}

export type ModAction = 'watch' | 'restrict' | 'dismiss';

export interface AppSettings {
  minPostsForScoring: number; // default 5
  riskThreshold: number; // default 70 — alert threshold
  enableShiftDetection: boolean; // default true
  demoMode: boolean; // default false
}
