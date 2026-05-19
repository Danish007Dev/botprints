export const SIGNALS = {
  TEMPORAL: { full: 'Temporal regularity', short: 'Timing', description: 'Measures how consistently spaced this user\'s posts are. A low coefficient of variation (very regular intervals) suggests automated scheduling.' },
  CIRCADIAN: { full: 'Circadian entropy', short: 'Circadian', description: 'Measures whether this user posts at the same times every day across all 24 hours. Humans have sleep cycles; bots post uniformly around the clock.' },
  ENGAGEMENT: { full: 'Engagement ratio', short: 'Engagement', description: 'Compares posts submitted vs comments left. Accounts that post heavily but never comment behave differently from normal community members.' },
  EDIT: { full: 'Edit absence', short: 'Edits', description: 'Measures how rarely this user edits their content compared to the community average. AI-generated content is rarely edited; humans correct typos.' },
  BURST: { full: 'Burst-silence', short: 'Bursts', description: 'Compares the longest gap between posts to the median gap. Accounts that post in batches then go silent suggest batch-queue automation.' },
  VOTE: { full: 'Vote correlation', short: 'Votes', description: 'Measures whether this user\'s posts receive suspiciously uniform upvote patterns shortly after posting — a signal of coordinated upvote rings.' },
};
