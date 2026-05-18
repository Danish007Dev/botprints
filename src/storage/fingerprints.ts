// ─── Ban Evasion Fingerprint Store ──────────────────────────────────────────
// Stores normalized behavioral vectors of banned users. On new account activity,
// computes cosine similarity against all stored fingerprints to detect returning bots.
// Privacy-preserving: no PII stored, only mathematical behavioral signatures.

import { redis } from '@devvit/web/server';
import type { BanFingerprint, BanEvasionMatch, ScoreBreakdown } from '../types/index.js';

const FINGERPRINT_KEY = 'bp:banned_fingerprints';

/**
 * Normalize a ScoreBreakdown into a unit vector [0-1] per dimension.
 * The 5 dimensions map to: temporal, circadian, engagement, editRate, burstSilence
 */
export function buildFingerprintVector(breakdown: ScoreBreakdown): number[] {
  return [
    breakdown.temporal / 25,       // max 25
    breakdown.circadian / 20,      // max 20
    breakdown.engagement / 20,     // max 20
    breakdown.editRate / 15,       // max 15
    breakdown.burstSilence / 20,   // max 20
  ];
}

/**
 * Cosine similarity between two vectors. Returns 0-1.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/**
 * Load all stored fingerprints from Redis.
 */
async function loadFingerprints(): Promise<BanFingerprint[]> {
  try {
    const raw = await redis.get(FINGERPRINT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BanFingerprint[];
  } catch {
    return [];
  }
}

/**
 * Save fingerprints array to Redis (capped at 200).
 */
async function saveFingerprints(fps: BanFingerprint[]): Promise<void> {
  const capped = fps.slice(-200); // keep latest 200
  await redis.set(FINGERPRINT_KEY, JSON.stringify(capped));
}

/**
 * Store a banned user's behavioral fingerprint.
 * Called when Tier 3 (ban) is executed.
 */
export async function storeBanFingerprint(
  username: string,
  breakdown: ScoreBreakdown
): Promise<void> {
  const fingerprint: BanFingerprint = {
    vector: buildFingerprintVector(breakdown),
    bannedAt: Date.now(),
    originalUsername: username,
  };
  const existing = await loadFingerprints();
  existing.push(fingerprint);
  await saveFingerprints(existing);
  console.log(`BotPrints: Stored ban fingerprint for u/${username}`);
}

/**
 * Match a new user's partial fingerprint against all stored ban fingerprints.
 * Returns the best match above the threshold, or null.
 */
export async function matchBanFingerprint(
  breakdown: ScoreBreakdown,
  threshold: number = 0.85
): Promise<BanEvasionMatch | null> {
  const newVector = buildFingerprintVector(breakdown);

  // Check if vector is all zeros (not enough signal)
  const magnitude = Math.sqrt(newVector.reduce((s, v) => s + v * v, 0));
  if (magnitude < 0.1) return null;

  const stored = await loadFingerprints();
  if (stored.length === 0) return null;

  let bestMatch: BanEvasionMatch | null = null;
  let bestSimilarity = 0;

  for (const fp of stored) {
    const sim = cosineSimilarity(newVector, fp.vector);
    if (sim >= threshold && sim > bestSimilarity) {
      bestSimilarity = sim;
      bestMatch = {
        similarity: Math.round(sim * 100) / 100,
        matchedFingerprint: fp,
      };
    }
  }

  return bestMatch;
}
