import { verifyAccess, verifyAccessIgnoringExpiry, verifyRefresh, signAccess, setAccessCookie, clearAccessCookie } from '../utils/tokens.js';
import { HttpError } from './error.js';
import User from '../models/User.js';

// Reads the httpOnly access_token cookie and sets req.user = { id, username }.
// If the access token has expired, the refresh token stored in the database is checked instead;
// when it is still valid a new access token is issued and the request carries on normally (200).
export async function requireAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) throw new HttpError(401, 'Not authenticated');

  let claims;
  try {
    claims = verifyAccess(token);
  } catch (err) {
    if (err.name !== 'TokenExpiredError') {
      clearAccessCookie(res);
      throw new HttpError(401, 'Invalid session');
    }
  }
  if (claims) {
    req.user = { id: claims.sub, username: claims.username };
    return next();
  }

  // Access token expired (but correctly signed): fall back to the refresh token in the database.
  const expired = verifyAccessIgnoringExpiry(token);
  const user = await User.findById(expired.sub).select('username refreshToken');

  let refresh = null;
  if (user?.refreshToken) {
    try {
      refresh = verifyRefresh(user.refreshToken);
    } catch {
      // the stored refresh token itself has expired: clear it
      await User.updateOne({ _id: user._id, refreshToken: user.refreshToken }, { $set: { refreshToken: null } });
    }
  }
  // The refresh token must belong to the same login session as this cookie (sid).
  // A newer login replaces the stored token, so an older device can no longer refresh.
  if (!refresh || refresh.jti !== expired.sid || refresh.sub !== expired.sub) {
    clearAccessCookie(res);
    throw new HttpError(401, 'Session expired, please log in again');
  }

  setAccessCookie(res, signAccess(user, refresh.jti));
  req.user = { id: user.id, username: user.username };
  next();
}

