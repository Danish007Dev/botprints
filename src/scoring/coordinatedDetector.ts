// ─── Coordinated Inauthentic Behavior (CIB) Detector ────────────────────────
// THE DIFFERENTIATOR — based on MIT 2024 CIB research.
// Detects bot rings operating on the same scheduler by finding users
// whose posting timestamps cluster in the same 5-minute windows.
// No other Devvit app does this.

import type { CoordinatedGroup, UserProfile } from '../types/index.js';

const WINDOW_MS = 5 * 60 * 1000; // 5-minute window

/**
 * Quantize timestamps into 5-minute buckets.
 * Returns a Set of bucket IDs for fast intersection.
 */
function toBuckets(timestamps: number[]): Set<number> {
  return new Set(timestamps.map((t) => Math.floor(t / WINDOW_MS)));
}

/**
 * Compute Jaccard similarity between two sets of time windows.
 * 0 = no overlap, 1 = identical timing.
 */
function jaccardSimilarity(a: Set<number>, b: Set<number>): number {
  let intersection = 0;
  for (const bucket of a) {
    if (b.has(bucket)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Detect coordinated groups from a set of user profiles.
 * Only considers users with score >= threshold (reduces computation).
 *
 * Algorithm: greedy clustering via pairwise Jaccard similarity on
 * quantized posting windows. O(n²) but n is small (only high-risk users).
 *
 * @returns Array of coordinated groups (2+ members with temporal overlap)
 */
export function detectCoordinatedGroups(
  profiles: { username: string; profile: UserProfile; score: number }[],
  scoreThreshold: number = 40,
  similarityThreshold: number = 0.15
): CoordinatedGroup[] {
  // Only analyze users above the score threshold
  const candidates = profiles.filter(
    (p) => p.score >= scoreThreshold && p.profile.postTimestamps.length >= 5
  );

  if (candidates.length < 2) return [];

  // Pre-compute bucket sets
  const bucketMap = new Map<string, Set<number>>();
  for (const c of candidates) {
    bucketMap.set(c.username, toBuckets(c.profile.postTimestamps));
  }

  // Pairwise similarity — build adjacency list
  const edges: { a: string; b: string; similarity: number; shared: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!.username;
      const b = candidates[j]!.username;
      const bucketsA = bucketMap.get(a)!;
      const bucketsB = bucketMap.get(b)!;
      const sim = jaccardSimilarity(bucketsA, bucketsB);

      if (sim >= similarityThreshold) {
        let shared = 0;
        for (const bucket of bucketsA) {
          if (bucketsB.has(bucket)) shared++;
        }
        edges.push({ a, b, similarity: sim, shared });
      }
    }
  }

  if (edges.length === 0) return [];

  // Greedy clustering: union-find style
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (x: string, y: string) => {
    parent.set(find(x), find(y));
  };

  for (const edge of edges) {
    union(edge.a, edge.b);
  }

  // Collect groups
  const groupMap = new Map<string, string[]>();
  for (const c of candidates) {
    const root = find(c.username);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root)!.push(c.username);
  }

  // Only return groups with 2+ members
  const groups: CoordinatedGroup[] = [];
  let groupIdx = 0;
  for (const [, members] of groupMap) {
    if (members.length < 2) continue;

    // Compute average similarity within group
    const groupEdges = edges.filter(
      (e) => members.includes(e.a) && members.includes(e.b)
    );
    const avgSim =
      groupEdges.length > 0
        ? groupEdges.reduce((s, e) => s + e.similarity, 0) / groupEdges.length
        : 0;
    const totalShared = groupEdges.reduce((s, e) => s + e.shared, 0);

    groups.push({
      id: `ring-${++groupIdx}`,
      members,
      avgCorrelation: Math.round(avgSim * 100) / 100,
      sharedWindows: totalShared,
    });
  }

  return groups.sort((a, b) => b.avgCorrelation - a.avgCorrelation);
}
