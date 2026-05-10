// ─── BotPrints API Routes ───────────────────────────────────────────────────
// Server endpoints called by the dashboard client via fetch('/api/...')

import { Hono } from 'hono';
import {
  getUserProfile,
  getAllUsernames,
  getTopRiskyUsers,
  getScoreHistory,
  getCommunityBaseline,
  saveUserProfile,
  registerUser,
  appendScoreHistory,
  updateUserScore,
  dismissUser,
} from '../storage/index.js';
import { computeRiskScore } from '../scoring/riskScore.js';
import { detectBehavioralShift } from '../scoring/shiftDetector.js';
import { DEMO_PROFILES } from '../data/demoData.js';
import { DEFAULT_BASELINE } from '../types/index.js';
import type { ScoredUser } from '../types/index.js';

export const api = new Hono();

api.get('/health', (c) => {
  return c.json({ status: 'ok', app: 'botprints', version: '0.1.0' });
});

// ─── Get Dashboard Data ─────────────────────────────────────────────────────
api.get('/dashboard', async (c) => {
  try {
    const topUsers = await getTopRiskyUsers(20);
    const baseline = await getCommunityBaseline();
    const allUsernames = await getAllUsernames();
    const scoredUsers: ScoredUser[] = [];

    for (const { username } of topUsers) {
      try {
        const profile = await getUserProfile(username);
        const breakdown = computeRiskScore(profile, baseline);
        const history = await getScoreHistory(username);
        const shift = detectBehavioralShift(history);
        scoredUsers.push({ username, score: breakdown.total, breakdown, shift, profile });
      } catch {
        // Skip users that error
      }
    }

    return c.json({
      users: scoredUsers,
      baseline,
      totalTracked: allUsernames.length,
      lastUpdated: baseline.lastComputed || Date.now(),
    });
  } catch (err) {
    console.error('BotPrints API: Error fetching dashboard data:', err);
    return c.json({ users: [], baseline: DEFAULT_BASELINE, totalTracked: 0, lastUpdated: 0 });
  }
});

// ─── Load Demo Data ─────────────────────────────────────────────────────────
api.post('/load-demo', async (c) => {
  try {
    const baseline = await getCommunityBaseline();
    for (const profile of DEMO_PROFILES) {
      await saveUserProfile(profile.username, profile);
      await registerUser(profile.username);
      const breakdown = computeRiskScore(profile, baseline);
      await updateUserScore(profile.username, breakdown.total);
      // Seed some history
      const fakeHistory = Array.from({ length: 7 }, () =>
        Math.max(0, breakdown.total + Math.floor(Math.random() * 20 - 10))
      );
      for (const s of fakeHistory) {
        await appendScoreHistory(profile.username, s);
      }
    }
    return c.json({ status: 'ok', loaded: DEMO_PROFILES.length });
  } catch (err) {
    console.error('BotPrints API: Error loading demo data:', err);
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Dismiss User ───────────────────────────────────────────────────────────
api.post('/dismiss/:username', async (c) => {
  const username = c.req.param('username');
  try {
    await dismissUser(username);
    return c.json({ status: 'ok' });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});
