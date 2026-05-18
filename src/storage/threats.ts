import { redis } from '@devvit/web/server';
import type { SharedThreat } from '../types/index.js';
import { getAutoActionSettings } from './settings.js';

// Push members of a confirmed ring to the shared threat layer
export async function pushSharedThreat(
  currentSubreddit: string,
  usernames: string[],
  confidence: number
): Promise<void> {
  const settings = await getAutoActionSettings();
  if (!settings.sharedThreatLayer) return; // Must be opted in

  for (const username of usernames) {
    const key = `global:threat:user:${username}`;
    // We only store it if it doesn't exist to preserve the origin of first detection
    const exists = await redis.get(key);
    if (!exists) {
      const threat: SharedThreat = {
        username,
        originSubreddit: currentSubreddit,
        detectedAt: Date.now(),
        confidence
      };
      await redis.set(key, JSON.stringify(threat));
      // Expiration could be 30 days
      await redis.expire(key, 30 * 24 * 60 * 60);
    }
  }
}

// Check if a user is a known threat in the global layer
export async function checkSharedThreat(username: string): Promise<SharedThreat | null> {
  const settings = await getAutoActionSettings();
  if (!settings.sharedThreatLayer) return null; // Must be opted in to read

  const key = `global:threat:user:${username}`;
  const data = await redis.get(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as SharedThreat;
  } catch {
    return null;
  }
}
