import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User, { ci } from '../models/User.js';
import { HttpError } from '../middleware/error.js';
import { ensureWallet } from '../services/walletService.js';
import { validateName, validateUsername, validateEmail, validatePassword } from '../../shared/validation.js';
import { refreshIdOf, verifyAccessIgnoringExpiry, clearAccessCookie, clearLegacyRefreshCookie } from '../utils/tokens.js';
import { startSession } from '../services/sessionService.js';

const router = Router();
const ok = { message: 'success' };

router.post('/signup', async (req, res) => {
  const { name, username, email, password } = req.body ?? {};
  const errors = {};
  const checks = { name: validateName(name), username: validateUsername(username), email: validateEmail(email), password: validatePassword(password) };
  for (const [k, v] of Object.entries(checks)) if (v) errors[k] = v;
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);

  if (await User.exists({ username }).collation(ci)) throw new HttpError(409, 'Username already taken');

  const user = new User({
    name: name.trim(),
    username,
    email: email?.trim() ?? '',
    passwordHash: await bcrypt.hash(password, 10),
  });
  try {
    await startSession(res, user);
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'Username already taken'); // lost a race with the check above
    throw err;
  }
  await ensureWallet(user._id); // every account starts with an empty wallet
  res.status(201).json(ok);
});

// The browser navigates to /dashboard after a 200 (a server redirect doesn't apply to fetch calls).
router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
    throw new HttpError(400, 'Username and password are required.');
  const user = await User.findOne({ username }).collation(ci);
  // same message for unknown user and wrong password, so usernames can't be probed
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    throw new HttpError(401, 'Invalid username or password');
  await startSession(res, user);
  res.json(ok);
});

// Clears the access cookie and the refresh token in the database. Works even after the access token expired.
router.post('/logout', async (req, res) => {
  const token = req.cookies?.access_token;
  if (token) {
    try {
      const claims = verifyAccessIgnoringExpiry(token);
      const user = await User.findById(claims.sub).select('refreshToken');
      // only end the session this cookie belongs to (a newer login on another device keeps its own)
      if (user?.refreshToken && refreshIdOf(user.refreshToken) === claims.sid)
        await User.updateOne({ _id: user._id, refreshToken: user.refreshToken }, { $set: { refreshToken: null } });
    } catch {
      /* tampered or unreadable cookie: nothing to revoke */
    }
  }
  clearAccessCookie(res);
  clearLegacyRefreshCookie(res);
  res.status(204).end();
});

export default router;
