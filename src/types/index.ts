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

export type ModAction = 'watch' | 'filter' | 'remove-appeal' | 'ban-report' | 'dismiss';

// ─── 3-Tier Enforcement ─────────────────────────────────────────────────────
// Tier 1 (60-79): Filter to modqueue for human review
// Tier 2 (80-89): Auto-remove content + appeal flow
// Tier 3 (90+):   Ban user + report content to admins

export type ActionTier = 'filter' | 'remove-appeal' | 'ban-report';

export interface AuditEntry {
  timestamp: number;
  action: ModAction;
  username: string;
  performedBy: string; // mod who triggered it
  details: string;
}

export interface AppealStatus {
  username: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
  removalReason: string;
  expiresAt?: number;
  reviewedBy?: string;
  reviewedAt?: number;
}

export type TierAction = 'nothing' | 'modqueue' | 'remove-appeal' | 'ban-report';
export type AppealTimeout = '24h' | '48h' | '72h' | 'never';

export interface AutoActionSettings {
  // ── Score Thresholds ──
  lowRiskCutoff: number;        // default 60 (range 30-80)
  mediumRiskCutoff: number;     // default 80 (range 50-95)
  highRiskCutoff: number;       // default 90 (range 70-100)

  // ── Per-Tier Auto-Actions ──
  lowRiskAction: TierAction;    // default 'nothing'
  mediumRiskAction: TierAction; // default 'nothing'
  highRiskAction: TierAction;   // default 'nothing'

  // ── Appeal Settings ──
  appealMessage: string;        // template with {username}, {subreddit}
  appealTimeout: AppealTimeout; // default 'never'
  autoEscalate: boolean;        // auto-escalate on timeout, default false

  // ── New Account Amplifier ──
  newAccountAmplifier: boolean; // default false
  newAccountThresholdDays: number; // default 30
  newAccountMultiplier: number; // default 1.3

  // ── Raid Alerts ──
  raidAlertsEnabled: boolean;   // default true

  // ── Daily Analysis ──
  dailyAnalysisHour: number;    // 0-23 UTC, default 0

  // ── Shared Threat Layer ──
  sharedThreatLayer: boolean;   // default false (opt-in)
}

export const DEFAULT_AUTO_ACTION_SETTINGS: AutoActionSettings = {
  lowRiskCutoff: 60,
  mediumRiskCutoff: 80,
  highRiskCutoff: 90,
  lowRiskAction: 'nothing',
  mediumRiskAction: 'nothing',
  highRiskAction: 'nothing',
  appealMessage:
    'We\u2019ve detected unusual activity on your account. If you believe this is a mistake, please reply to this message with a brief explanation of your recent activity in r/{subreddit}. Your appeal will be reviewed by a moderator.',
  appealTimeout: 'never',
  autoEscalate: false,
  newAccountAmplifier: false,
  newAccountThresholdDays: 30,
  newAccountMultiplier: 1.3,
  raidAlertsEnabled: true,
  dailyAnalysisHour: 0,
  sharedThreatLayer: false,
};

// ─── Raid Detection ─────────────────────────────────────────────────────────

export interface RaidSettings {
  triggerThreshold: number; // min suspicious accounts to trigger (default 5, range 3-10)
  triggerWindowMinutes: number; // rolling window in minutes (default 15, range 5-30)
  minScoreForRaid: number; // min risk score to count toward raid (default 60, range 40-80)
}

export const DEFAULT_RAID_SETTINGS: RaidSettings = {
  triggerThreshold: 5,
  triggerWindowMinutes: 15,
  minScoreForRaid: 60,
};

export interface RaidParticipant {
  username: string;
  score: number;
  lastPostTimestamp: number;
}

export interface RaidState {
  active: boolean;
  startedAt: number;
  participantCount: number;
  participants: RaidParticipant[];
  alertSentAt: number;
  cooldownEndsAt: number;
}
