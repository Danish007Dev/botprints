// ─── BotPrints Trigger Handlers ─────────────────────────────────────────────
// Silent background data collection + real-time raid detection.
// RULES: Always try/catch. No unhandled exceptions.

import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnPostCreateRequest,
  OnPostDeleteRequest,
  OnPostUpdateRequest,
  OnCommentCreateRequest,
  OnCommentDeleteRequest,
  OnCommentUpdateRequest,
  OnModActionRequest,
  OnModMailRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { isSystemAccount, isValidUsername } from '../shared/accounts.js';
import {
  getUserProfile,
  saveUserProfile,
  registerUser,
  isUserWatched,
  isUserFiltered,
  getCachedRiskScore,
  getCommunityBaseline,
  getScoreHistory,
  getAppealStatus,
  // Raid detection
  recordRaidActivity,
  checkRaidCondition,
  isRaidCooldownActive,
  setRaidCooldown,
  setRaidState,
  getRaidSettings,
  checkSharedThreat,
  matchBanFingerprint,
} from '../storage/index.js';
import { computeRiskScore } from '../scoring/riskScore.js';
import { detectBehavioralShift } from '../scoring/shiftDetector.js';
import type { RaidParticipant } from '../types/index.js';
import { SIGNALS } from '../shared/signals.js';

export const triggers = new Hono();

async function resolveUsername(
  raw: string | undefined,
  userId: string | undefined,
  context: string
): Promise<string | null> {
  if (isValidUsername(raw)) return raw;

  if (userId) {
    try {
      const user = await reddit.getUserById(userId as `t2_${string}`);
      const resolved = user?.username;
      if (isValidUsername(resolved)) return resolved;
    } catch (err) {
      console.warn('BotPrints: Could not resolve username by id', {
        context,
        userId,
        err,
      });
    }
  }

  console.error(`BotPrints: Missing username in ${context}`, { raw, userId });
  return null;
}

// ─── onAppInstall ───────────────────────────────────────────────────────────
triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('BotPrints installed to subreddit: r/' + input.subreddit?.name);
  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

// ─── onModMail ──────────────────────────────────────────────────────────────
triggers.post('/on-mod-mail', async (c) => {
  try {
    const input = await c.req.json<OnModMailRequest>();
    const username = input.messageAuthor?.name;
    if (!username) return c.json<TriggerResponse>({ status: 'success' }, 200);
    if (input.messageAuthorType !== 'participant_user') return c.json<TriggerResponse>({ status: 'success' }, 200);
    
    const appeal = await getAppealStatus(username);
    if (!appeal || appeal.status !== 'pending') return c.json<TriggerResponse>({ status: 'success' }, 200);
    
    const subredditName = input.conversationSubreddit?.name;
    if (!subredditName) return c.json<TriggerResponse>({ status: 'success' }, 200);

    const profile = await getUserProfile(username);
    const history = await getScoreHistory(username);
    const subredditId = input.conversationSubreddit?.id
      || (await reddit.getCurrentSubreddit()).id;
    const baseline = await getCommunityBaseline(subredditId);
    const breakdown = computeRiskScore(profile, baseline);
    const shift = detectBehavioralShift(history);
    
    let annotation = `🚨 **BotPrints Appeal Annotation** 🚨\n\n`;
    annotation += `u/${username} is currently in **Pending Appeal** state.\n\n`;
    annotation += `**Suspicion Score**: ${breakdown.total}/100\n`;
    if (shift?.shifted) {
      annotation += `**Behavior Shift**: ⚠️ Magnitude ${shift.magnitude}x\n`;
    }
    annotation += `**Signals**: ${SIGNALS.TEMPORAL.full} (${breakdown.temporal}), ${SIGNALS.CIRCADIAN.full} (${breakdown.circadian}), ${SIGNALS.ENGAGEMENT.full} (${breakdown.engagement})\n\n`;
    annotation += `Review this user's appeal in the BotPrints Dashboard, or reply to them here.`;
    
    await reddit.modMail.reply({
      conversationId: input.conversationId,
      body: annotation,
      isInternal: true,
    });
    
    // Highlight the conversation for moderators to see clearly
    try {
      await reddit.modMail.highlightConversation(input.conversationId);
    } catch (e) {
      console.warn('BotPrints: Could not highlight modmail conversation:', e);
    }

    console.log(`BotPrints: Annotated modmail from pending appeal user u/${username}`);
  } catch (err) {
    console.error('BotPrints: /on-mod-mail error:', err);
  }
  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

// ─── Helper: Get highest signal name from a score breakdown ─────────────────
function getHighestSignal(breakdown: { temporal: number; circadian: number; engagement: number; editRate: number; burstSilence: number; voteCorrelation: number }): string {
  const signals = [
    { name: SIGNALS.TEMPORAL.full, value: breakdown.temporal, max: 25 },
    { name: SIGNALS.CIRCADIAN.full, value: breakdown.circadian, max: 20 },
    { name: SIGNALS.ENGAGEMENT.full, value: breakdown.engagement, max: 15 },
    { name: SIGNALS.EDIT.full, value: breakdown.editRate, max: 10 },
    { name: SIGNALS.BURST.full, value: breakdown.burstSilence, max: 15 },
    { name: SIGNALS.VOTE.full, value: breakdown.voteCorrelation, max: 15 },
  ];
  // Sort by normalized value (value/max) descending
  signals.sort((a, b) => (b.value / b.max) - (a.value / a.max));
  return signals[0]!.name;
}

// ─── Helper: Build watchlist modmail for a specific piece of content ────────
async function sendWatchAlert(
  username: string,
  contentType: 'post' | 'comment',
  contentUrl: string | undefined,
  subredditId: string,
  subredditName: string
): Promise<void> {
  try {
    // Get current risk score for the alert
    const profile = await getUserProfile(username);
    const baseline = await getCommunityBaseline(subredditId);
    const breakdown = computeRiskScore(profile, baseline);
    const highestSignal = getHighestSignal(breakdown);

    const directLink = contentUrl
      ? `[View the ${contentType}](${contentUrl})`
      : `[View u/${username}'s profile](https://www.reddit.com/user/${username})`;

    await reddit.modMail.createModInboxConversation({
      subredditId: subredditId as any,
      subject: `BotPrints Watch Alert — u/${username} just posted in r/${subredditName}`,
      bodyMarkdown:
        `🔬 **BotPrints Watch Alert**\n\n` +
        `**User:** u/${username}\n` +
        `**Activity:** New ${contentType} in r/${subredditName}\n` +
        `**Suspicion Score:** ${breakdown.total}/100\n` +
        `**Top Signal:** ${highestSignal}\n\n` +
        `${directLink}\n\n` +
        `---\n\n` +
        `**Quick actions:**\n` +
        `- ✅ Approve — content looks legitimate\n` +
        `- 🗑️ Remove — remove this ${contentType}\n` +
        `- 🚫 Ban — ban u/${username} from r/${subredditName}\n\n` +
        `*Use the moderation tools on the linked ${contentType} to take action.*`,
    });
    console.log(`BotPrints: Sent watch alert modmail for u/${username} (${contentType})`);
  } catch (e) {
    console.error('BotPrints: Failed to send watch alert:', e);
  }
}

// ─── Helper: Filter content to modqueue if user is on the filter list ───────
async function filterContentIfNeeded(
  username: string,
  contentType: 'post' | 'comment',
  contentId: string | undefined
): Promise<void> {
  try {
    const filtered = await isUserFiltered(username);
    if (!filtered || !contentId) return;

    // Use the filter/remove API to route content to modqueue
    if (contentType === 'post') {
      const post = await reddit.getPostById(contentId as `t3_${string}`);
      await post.remove(); // Remove from public feed → appears in modqueue
      console.log(`BotPrints: Filtered post ${contentId} by u/${username} to modqueue`);
    } else {
      const comment = await reddit.getCommentById(contentId as `t1_${string}`);
      await comment.remove(); // Remove from public feed → appears in modqueue
      console.log(`BotPrints: Filtered comment ${contentId} by u/${username} to modqueue`);
    }
  } catch (e) {
    console.warn(`BotPrints: Could not filter ${contentType} for u/${username}:`, e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RAID DETECTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O(1) raid check. Called after every post/comment from a scored user.
 * Steps:
 *   1. Lookup cached risk score (O(1) zScore)
 *   2. If score >= threshold, record activity in sliding window
 *   3. Check if window count >= raid trigger threshold
 *   4. If yes AND no cooldown → fire raid alert modmail
 */
async function checkForRaid(
  username: string,
  subredditId: string | undefined,
  subredditName: string | undefined
): Promise<void> {
  try {
    // 1. Fast cached score lookup — O(1)
    const cachedScore = await getCachedRiskScore(username);
    const settings = await getRaidSettings();

    if (cachedScore < settings.minScoreForRaid) {
      return; // Not suspicious enough to count toward raid
    }

    // 2. Record this user's activity in the sliding window
    await recordRaidActivity(username, cachedScore);

    // 3. Check if raid conditions are met
    const participants = await checkRaidCondition();
    if (!participants) {
      return; // Below threshold
    }

    // 4. Check cooldown — don't fire duplicate alerts
    if (await isRaidCooldownActive()) {
      return; // Already alerted recently
    }

    // 🚨 RAID DETECTED — Fire alert!
    console.log(`🚨 BotPrints: RAID DETECTED! ${participants.length} suspicious accounts active in last ${settings.triggerWindowMinutes} minutes`);

    // Set cooldown immediately to prevent duplicate alerts
    await setRaidCooldown();

    // Save raid state for dashboard banner
    const now = Date.now();
    await setRaidState({
      active: true,
      startedAt: now,
      participantCount: participants.length,
      participants: participants.slice(0, 20), // Cap at 20 for storage
      alertSentAt: now,
      cooldownEndsAt: now + 2 * 60 * 60 * 1000, // 2 hours
    });

    // Send raid alert modmail
    if (subredditId && subredditName) {
      await sendRaidAlert(participants, subredditId, subredditName);
    }
  } catch (e) {
    // Raid check must never crash the trigger
    console.warn('BotPrints: Raid check error (non-fatal):', e);
  }
}

/**
 * Send a raid alert modmail to the mod team.
 */
async function sendRaidAlert(
  participants: RaidParticipant[],
  subredditId: string,
  subredditName: string
): Promise<void> {
  try {
    const userList = participants
      .slice(0, 15) // Cap the list to keep modmail readable
      .map((p) => `- u/${p.username} — Suspicion Score: **${p.score}**/100`)
      .join('\n');

    const usernames = participants.map((p) => p.username);
    const usernameList = usernames.slice(0, 15).map((u) => `u/${u}`).join(', ');

    await reddit.modMail.createModInboxConversation({
      subredditId: subredditId as any,
      subject: `🚨 BotPrints RAID ALERT — ${participants.length} suspicious accounts active in r/${subredditName}`,
      bodyMarkdown:
        `# 🚨 Raid Alert\n\n` +
        `**${participants.length} accounts** with high behavioral anomaly scores have posted in r/${subredditName} within the last few minutes.\n\n` +
        `## Suspicious Accounts\n\n` +
        `${userList}\n\n` +
        `---\n\n` +
        `## Recommended Actions\n\n` +
        `1. **Check modqueue** — Content from these accounts may already be queued for review\n` +
        `2. **Open the BotPrints Dashboard** — Use the bulk action tools to Filter or Ban raid participants\n` +
        `3. **Filter All** — Automatically queue all future content from: ${usernameList}\n\n` +
        `---\n\n` +
        `*This alert has a 2-hour cooldown. You will not receive another raid alert for the same event.*\n` +
        `*Adjust raid detection thresholds in the BotPrints Dashboard settings.*`,
    });
    console.log(`BotPrints: Raid alert modmail sent — ${participants.length} participants`);
  } catch (e) {
    console.error('BotPrints: Failed to send raid alert modmail:', e);
  }
}

// ─── onPostCreate ───────────────────────────────────────────────────────────
// Updates: posts counter, postTimestamps (cap 50), hourBuckets, registers user
triggers.post('/on-post-create', async (c) => {
  try {
    const input = await c.req.json<OnPostCreateRequest>();
    const authorId = input.post?.authorId || input.author?.id;
    if (isSystemAccount(authorId)) {
      console.log(`BotPrints: Skipping system account post (${authorId})`);
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    const username = await resolveUsername(
      input.author?.name,
      authorId,
      'on-post-create'
    );
    if (isSystemAccount(authorId, username)) {
      console.warn('BotPrints: Skipping unresolved post author', { authorId });
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    if (!username || username === 'AutoModerator') {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const profile = await getUserProfile(username);
    profile.username = username;
    if (authorId) profile.userId = authorId;
    
    // 🌐 Cross-subreddit threat intel check on first activity
    if (profile.posts === 0 && profile.comments === 0 && !profile.sharedThreat) {
      const threat = await checkSharedThreat(username);
      if (threat && threat.originSubreddit !== input.subreddit?.name) {
        profile.sharedThreat = threat;
        console.log(`BotPrints: Shared Threat detected! u/${username} originated from r/${threat.originSubreddit}`);
      }
    }

    const createdAt = input.post?.createdAt;
    const hour = createdAt
      ? new Date(createdAt).getUTCHours()
      : new Date().getUTCHours();

    profile.posts += 1;
    profile.postTimestamps = [...profile.postTimestamps, Date.now()].slice(-50);
    profile.hourBuckets[hour] = (profile.hourBuckets[hour] ?? 0) + 1;

    console.log(`BotPrints: onPostCreate -> Registered post for u/${username}. Total posts: ${profile.posts}`);

    await saveUserProfile(username, profile);
    await registerUser(username);

    // Tier 1: Filter to modqueue if user is on the filter list
    const postId = input.post?.id;
    await filterContentIfNeeded(username, 'post', postId);

    // 🚨 Raid detection — check sliding window
    await checkForRaid(username, input.subreddit?.id, input.subreddit?.name);

    // Watchlist alert with direct link to the specific post
    if (await isUserWatched(username)) {
      if (input.subreddit?.id) {
        const postUrl = input.post?.permalink
          ? `https://www.reddit.com${input.post.permalink}`
          : undefined;
        await sendWatchAlert(
          username,
          'post',
          postUrl,
          input.subreddit.id,
          input.subreddit.name || 'unknown'
        );
      }
    }

    // 🕵️ Ban evasion fingerprint check for new accounts
    if (profile.posts >= 5 && !profile.banEvasionMatch) {
      const accountAgeDays = (Date.now() - profile.firstSeen) / (1000 * 60 * 60 * 24);
      if (accountAgeDays < 30) {
        try {
          const baseline = await getCommunityBaseline(input.subreddit?.id);
          const breakdown = computeRiskScore(profile, baseline, { allowLowSignal: true });
          const match = await matchBanFingerprint(breakdown);
          if (match) {
            profile.banEvasionMatch = match;
            await saveUserProfile(username, profile);
            console.log(`BotPrints: Ban evasion detected! u/${username} matches banned u/${match.matchedFingerprint.originalUsername} (${Math.round(match.similarity * 100)}%)`);

            // Send modmail alert
            if (input.subreddit?.id) {
              try {
                const riskLabel = breakdown.hasEnoughData
                  ? `${breakdown.total}/100`
                  : 'Insufficient data';
                await reddit.modMail.createModInboxConversation({
                  subredditId: input.subreddit.id as any,
                  subject: `BotPrints: Possible ban evader — u/${username}`,
                  bodyMarkdown:
                    `🕵️ **Ban Evasion Alert**\n\n` +
                    `**New account:** u/${username}\n` +
                    `**Behavioral similarity:** ${Math.round(match.similarity * 100)}% match to previously banned u/${match.matchedFingerprint.originalUsername}\n` +
                    `**Suspicion Score:** ${riskLabel}\n` +
                    `**Account age:** ${Math.round(accountAgeDays)} days\n\n` +
                    `This is an alert only — no automatic action has been taken. Review recommended.\n\n` +
                    `---\n\n` +
                    `*BotPrints uses privacy-preserving behavioral fingerprints (no PII) to detect ban evasion.*`,
                });
              } catch (e) {
                console.warn('BotPrints: Could not send ban evasion modmail:', e);
              }
            }
          }
        } catch (fpErr) {
          console.warn('BotPrints: Ban evasion check error (non-fatal):', fpErr);
        }
      }
    }

    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onPostCreate trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onPostUpdate ───────────────────────────────────────────────────────────
// Tracks post score deltas for Vote Correlation signal (6th signal).
triggers.post('/on-post-update', async (c) => {
  try {
    const input = await c.req.json<OnPostUpdateRequest>();
    const authorId = input.post?.authorId || input.author?.id;
    if (isSystemAccount(authorId)) {
      console.log(`BotPrints: Skipping system account post update (${authorId})`);
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    const username = await resolveUsername(
      input.author?.name,
      authorId,
      'on-post-update'
    );
    if (isSystemAccount(authorId, username)) {
      console.warn('BotPrints: Skipping unresolved post update author', { authorId });
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    if (!username || username === 'AutoModerator') {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const score = input.post?.score;
    if (typeof score === 'number' && score > 0) {
      const profile = await getUserProfile(username);
      profile.username = username;
      if (authorId) profile.userId = authorId;
      if (!profile.voteScoreDeltas) {
        profile.voteScoreDeltas = [];
      }
      profile.voteScoreDeltas = [...profile.voteScoreDeltas, score].slice(-20);
      await saveUserProfile(username, profile);
    }

    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onPostUpdate trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onCommentCreate ────────────────────────────────────────────────────────
// Increments comment counter only
triggers.post('/on-comment-create', async (c) => {
  try {
    const input = await c.req.json<OnCommentCreateRequest>();
    const authorId = input.author?.id;
    if (isSystemAccount(authorId)) {
      console.log(`BotPrints: Skipping system account comment (${authorId})`);
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    const username = await resolveUsername(
      input.author?.name,
      authorId,
      'on-comment-create'
    );
    if (isSystemAccount(authorId, username)) {
      console.warn('BotPrints: Skipping unresolved comment author', { authorId });
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    if (!username || username === 'AutoModerator') {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const profile = await getUserProfile(username);
    profile.username = username;
    if (authorId) profile.userId = authorId;
    
    // 🌐 Cross-subreddit threat intel check on first activity
    if (profile.posts === 0 && profile.comments === 0 && !profile.sharedThreat) {
      const threat = await checkSharedThreat(username);
      if (threat && threat.originSubreddit !== input.subreddit?.name) {
        profile.sharedThreat = threat;
        console.log(`BotPrints: Shared Threat detected! u/${username} originated from r/${threat.originSubreddit}`);
      }
    }

    profile.comments += 1;

    console.log(`BotPrints: onCommentCreate -> Registered comment for u/${username}. Total comments: ${profile.comments}`);

    await saveUserProfile(username, profile);
    await registerUser(username);

    // Tier 1: Filter to modqueue if user is on the filter list
    const commentId = input.comment?.id;
    await filterContentIfNeeded(username, 'comment', commentId);

    // 🚨 Raid detection — check sliding window
    await checkForRaid(username, input.subreddit?.id, input.subreddit?.name);

    // Watchlist alert with direct link to the specific comment
    if (await isUserWatched(username)) {
      if (input.subreddit?.id) {
        const commentUrl = input.comment?.permalink
          ? `https://www.reddit.com${input.comment.permalink}`
          : undefined;
        await sendWatchAlert(
          username,
          'comment',
          commentUrl,
          input.subreddit.id,
          input.subreddit.name || 'unknown'
        );
      }
    }

    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onCommentCreate trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onPostUpdate ───────────────────────────────────────────────────────────
// Increments edit counter
triggers.post('/on-post-update', async (c) => {
  try {
    const input = await c.req.json<OnPostUpdateRequest>();
    const authorId = input.post?.authorId || input.author?.id;
    if (isSystemAccount(authorId)) {
      console.log(`BotPrints: Skipping system account post edit (${authorId})`);
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    const username = await resolveUsername(
      input.author?.name,
      authorId,
      'on-post-update-edit'
    );
    if (isSystemAccount(authorId, username)) {
      console.warn('BotPrints: Skipping unresolved post edit author', { authorId });
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    if (!username) {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const profile = await getUserProfile(username);
    profile.username = username;
    if (authorId) profile.userId = authorId;
    profile.edits += 1;

    await saveUserProfile(username, profile);

    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onPostUpdate trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onCommentUpdate ────────────────────────────────────────────────────────
// Increments edit counter
triggers.post('/on-comment-update', async (c) => {
  try {
    const input = await c.req.json<OnCommentUpdateRequest>();
    const authorId = input.author?.id;
    if (isSystemAccount(authorId)) {
      console.log(`BotPrints: Skipping system account comment update (${authorId})`);
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    const username = await resolveUsername(
      input.author?.name,
      authorId,
      'on-comment-update'
    );
    if (isSystemAccount(authorId, username)) {
      console.warn('BotPrints: Skipping unresolved comment update author', { authorId });
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    if (!username) {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const profile = await getUserProfile(username);
    profile.username = username;
    if (authorId) profile.userId = authorId;
    profile.edits += 1;

    await saveUserProfile(username, profile);

    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onCommentUpdate trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onPostDelete ──────────────────────────────────────────────────────────
triggers.post('/on-post-delete', async (c) => {
  try {
    const input = await c.req.json<OnPostDeleteRequest>();
    const authorId = input.author?.id;
    if (isSystemAccount(authorId)) {
      console.log(`BotPrints: Skipping system account post delete (${authorId})`);
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    const username = await resolveUsername(
      input.author?.name,
      authorId,
      'on-post-delete'
    );
    if (isSystemAccount(authorId, username)) {
      console.warn('BotPrints: Skipping unresolved post delete author', { authorId });
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    if (username === 'AutoModerator') {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onPostDelete trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onCommentDelete ───────────────────────────────────────────────────────
triggers.post('/on-comment-delete', async (c) => {
  try {
    const input = await c.req.json<OnCommentDeleteRequest>();
    const authorId = input.author?.id;
    if (isSystemAccount(authorId)) {
      console.log(`BotPrints: Skipping system account comment delete (${authorId})`);
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    const username = await resolveUsername(
      input.author?.name,
      authorId,
      'on-comment-delete'
    );
    if (isSystemAccount(authorId, username)) {
      console.warn('BotPrints: Skipping unresolved comment delete author', { authorId });
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    if (username === 'AutoModerator') {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onCommentDelete trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onModAction ───────────────────────────────────────────────────────────
triggers.post('/on-mod-action', async (c) => {
  try {
    const input = await c.req.json<OnModActionRequest>();
    const moderatorId = input.moderator?.id;
    if (isSystemAccount(moderatorId)) {
      console.log(`BotPrints: Skipping system account mod action (${moderatorId})`);
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    const moderator = await resolveUsername(
      input.moderator?.name,
      moderatorId,
      'on-mod-action'
    );
    if (isSystemAccount(moderatorId, moderator)) {
      console.warn('BotPrints: Skipping unresolved mod action author', { moderatorId });
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    if (moderator === 'AutoModerator') {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onModAction trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});
