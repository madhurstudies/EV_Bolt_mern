import { signAccess, signRefresh, setAccessCookie, clearLegacyRefreshCookie } from '../utils/tokens.js';

// New login session: refresh token (30 days) saved in the database, access token (5 min) in the cookie.
// Saving a new refresh token replaces the old one, so only one device is signed in at a time.
// Used by signup, login, and a password change (which signs every other device out).
export async function startSession(res, user) {
  const { token, jti } = signRefresh(user);
  user.refreshToken = token;
  await user.save();
  setAccessCookie(res, signAccess(user, jti));
  clearLegacyRefreshCookie(res);
}
