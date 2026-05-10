// ─── BotPrints API Routes ───────────────────────────────────────────────────
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
import { detectCoordinatedGroups } from '../scoring/coordinatedDetector.js';
import { DEMO_PROFILES } from '../data/demoData.js';
import { DEFAULT_BASELINE } from '../types/index.js';
import type { ScoredUser, SubredditSummary } from '../types/index.js';

export const api = new Hono();

api.get('/health', (c) => c.json({ status: 'ok', app: 'botprints', version: '0.2.0' }));

// ─── Dashboard Data ─────────────────────────────────────────────────────────
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
      } catch { /* skip */ }
    }

    // Coordinated group detection
    const coordGroups = detectCoordinatedGroups(scoredUsers);
    // Tag users with their group ID
    for (const group of coordGroups) {
      for (const member of group.members) {
        const user = scoredUsers.find(u => u.username === member);
        if (user) user.coordGroup = group.id;
      }
    }

    // Subreddit summary
    const highRiskCount = scoredUsers.filter(u => u.score >= 70).length;
    const shiftedCount = scoredUsers.filter(u => u.shift?.shifted).length;
    const avgRisk = scoredUsers.length > 0
      ? scoredUsers.reduce((s, u) => s + u.score, 0) / scoredUsers.length
      : 0;

    const summary: SubredditSummary = {
      totalTracked: allUsernames.length,
      highRiskCount,
      shiftedCount,
      coordGroupCount: coordGroups.length,
      healthScore: Math.round(Math.max(0, 100 - avgRisk)),
      lastScan: baseline.lastComputed || Date.now(),
    };

    return c.json({ users: scoredUsers, coordGroups, summary, baseline });
  } catch (err) {
    console.error('BotPrints API error:', err);
    return c.json({
      users: [], coordGroups: [], baseline: DEFAULT_BASELINE,
      summary: { totalTracked: 0, highRiskCount: 0, shiftedCount: 0, coordGroupCount: 0, healthScore: 100, lastScan: 0 },
    });
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
      const fakeHistory = Array.from({ length: 7 }, () =>
        Math.max(0, breakdown.total + Math.floor(Math.random() * 20 - 10))
      );
      for (const s of fakeHistory) {
        await appendScoreHistory(profile.username, s);
      }
    }
    return c.json({ status: 'ok', loaded: DEMO_PROFILES.length });
  } catch (err) {
    console.error('BotPrints API: Error loading demo:', err);
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

// ─── Single User Profile ────────────────────────────────────────────────────
api.get('/user/:username', async (c) => {
  const username = c.req.param('username');
  try {
    const profile = await getUserProfile(username);
    const baseline = await getCommunityBaseline();
    const breakdown = computeRiskScore(profile, baseline);
    const history = await getScoreHistory(username);
    const shift = detectBehavioralShift(history);
    return c.json({ username, score: breakdown.total, breakdown, shift, profile });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});
