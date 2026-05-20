// ─── Storage Layer Barrel Export ─────────────────────────────────────────────
export {
  getUserProfile,
  saveUserProfile,
  registerUser,
  unregisterUser,
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
  removeUserScore,
  getCachedRiskScore,
  getTopRiskyUsers,
  dismissUser,
  isUserDismissed,
  addToWatchlist,
  removeFromWatchlist,
  isUserWatched,
  undismissUser,
  getClearedUsernames,
  markUserActioned,
  unmarkUserActioned,
  isUserActioned,
  getActionedUsernames,
  // 3-Tier Enforcement
  addToFilterList,
  removeFromFilterList,
  isUserFiltered,
  setAppealStatus,
  getAppealStatus,
  clearAppealStatus,
  getAllPendingAppeals,
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

// Auto-Action Settings
export {
  getAutoActionSettings,
  saveAutoActionSettings,
} from './settings.js';

// Metrics
export {
  incrementMetric,
  getDashboardMetrics,
} from './metrics.js';

// Shared Threat Layer
export {
  pushSharedThreat,
  checkSharedThreat,
} from './threats.js';

// Ban Evasion Fingerprints
export {
  storeBanFingerprint,
  matchBanFingerprint,
  buildFingerprintVector,
} from './fingerprints.js';
