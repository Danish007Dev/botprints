// ─── Storage Layer Barrel Export ─────────────────────────────────────────────
export {
  getUserProfile,
  saveUserProfile,
  registerUser,
  getAllUsernames,
  getScoreHistory,
  appendScoreHistory,
} from './users.js';

export {
  getCommunityBaseline,
  saveCommunityBaseline,
} from './community.js';

export {
  updateUserScore,
  getCachedRiskScore,
  getTopRiskyUsers,
  dismissUser,
  isUserDismissed,
  addToWatchlist,
  removeFromWatchlist,
  isUserWatched,
  undismissUser,
  getClearedUsernames,
  // 3-Tier Enforcement
  addToFilterList,
  removeFromFilterList,
  isUserFiltered,
  setAppealStatus,
  getAppealStatus,
  clearAppealStatus,
  appendAuditEntry,
  getAuditLog,
} from './scores.js';

// Raid Detection
export {
  getRaidSettings,
  saveRaidSettings,
  recordRaidActivity,
  checkRaidCondition,
  isRaidCooldownActive,
  setRaidCooldown,
  setRaidState,
  getRaidState,
  clearRaidState,
} from './raid.js';
