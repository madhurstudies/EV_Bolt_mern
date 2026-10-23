import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export const ACCESS_TTL_S = 5 * 60; // access token: 5 minutes
export const REFRESH_TTL_S = 30 * 24 * 60 * 60; // refresh token: 30 days

function secret(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Access token: short-lived, sent to the browser in an httpOnly cookie.
// `sid` is the id of the refresh token it was issued with, tying it to one login session.
export function signAccess(user, sid) {
  return jwt.sign({ sub: String(user._id), username: user.username, sid }, secret('JWT_ACCESS_SECRET'), {
    expiresIn: ACCESS_TTL_S,
  });
}

// Refresh token: long-lived, kept ONLY in the database (user.refreshToken). Never sent to the browser.
export function signRefresh(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: String(user._id) }, secret('JWT_REFRESH_SECRET'), {
    expiresIn: REFRESH_TTL_S,
    jwtid: jti,
  });
  return { token, jti };
}

// Both throw if the token is tampered with or expired (expiry -> err.name === 'TokenExpiredError').
export const verifyAccess = (t) => jwt.verify(t, secret('JWT_ACCESS_SECRET'));
export const verifyRefresh = (t) => jwt.verify(t, secret('JWT_REFRESH_SECRET'));

// Signature is still checked; only the expiry is ignored. Used to refresh and to log out.
export const verifyAccessIgnoringExpiry = (t) => jwt.verify(t, secret('JWT_ACCESS_SECRET'), { ignoreExpiration: true });

// The refresh token's id without checking expiry (to match a stored token to a session).
export const refreshIdOf = (t) => jwt.decode(t)?.jti ?? null;

const base = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
});

// The token inside expires after 5 minutes, but the cookie lives as long as the refresh token.
// If the browser dropped the cookie at 5 minutes, the server could never see it to refresh it.
export function setAccessCookie(res, token) {
  res.cookie('access_token', token, { ...base(), path: '/', maxAge: REFRESH_TTL_S * 1000 });
}

export function clearAccessCookie(res) {
  res.clearCookie('access_token', { ...base(), path: '/' });
}

// Older versions kept the refresh token in a cookie; remove it from browsers that still have one.
export function clearLegacyRefreshCookie(res) {
  res.clearCookie('refresh_token', { ...base(), path: '/api/auth' });
}
