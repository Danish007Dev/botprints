export const SIGNALS = {
  TEMPORAL: { full: 'Temporal regularity', short: 'Timing', description: 'Unnatural posting regularity — bots use cron jobs.' },
  CIRCADIAN: { full: 'Circadian entropy', short: 'Circadian', description: 'Posts 24/7 without a normal sleep cycle.' },
  ENGAGEMENT: { full: 'Engagement ratio', short: 'Engagement', description: 'Posts heavily without ever commenting.' },
  EDIT: { full: 'Edit absence', short: 'Edits', description: 'Rarely edits content compared to normal users.' },
  BURST: { full: 'Burst-silence', short: 'Bursts', description: 'Posts in rapid bursts followed by long silence.' },
  VOTE: { full: 'Vote correlation', short: 'Votes', description: 'Suspicious upvote patterns shortly after posting.' },
};
