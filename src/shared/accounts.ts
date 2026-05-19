const REDACTED_USERNAMES = new Set(['[redacted]', '[deleted]']);
const SYSTEM_USER_IDS = new Set(['t2_0', 't2_deleted']);

export function isValidUsername(username: string | null | undefined): username is string {
  if (!username) return false;
  if (username.startsWith('t2_')) return false; // Prevent raw user IDs from being treated as usernames
  return !REDACTED_USERNAMES.has(username);
}

export function isSystemAccount(
  userId: string | null | undefined,
  username?: string | null
): boolean {
  if (userId && SYSTEM_USER_IDS.has(userId)) return true;
  if (username !== undefined && !isValidUsername(username)) return true;
  return false;
}
