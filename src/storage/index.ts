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
  getTopRiskyUsers,
  dismissUser,
  isUserDismissed,
  addToWatchlist,
  removeFromWatchlist,
  isUserWatched,
  undismissUser,
  getClearedUsernames,
} from './scores.js';
