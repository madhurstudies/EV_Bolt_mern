import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import Booking from '../models/Booking.js';
import Slot from '../models/Slot.js';
import Wallet from '../models/Wallet.js';
import WalletTxn from '../models/WalletTxn.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { validateName, validateEmail, validatePassword } from '../../shared/validation.js';
import { startSession } from '../services/sessionService.js';
import { FREE } from '../services/slotService.js';
import { inr } from '../services/walletService.js';
import { clearAccessCookie, clearLegacyRefreshCookie } from '../utils/tokens.js';

const router = Router();
router.use(requireAuth);

const profile = (u) => ({ id: u.id, name: u.name, username: u.username, email: u.email });

async function current(req) {
  const u = await User.findById(req.user.id);
  if (!u) throw new HttpError(401, 'User not found');
  return u;
}

// A wrong password here is a 400 with a field error, not a 401, because the browser treats 401 as "log in again".
async function checkPassword(user, password, field) {
  if (typeof password !== 'string' || !password || !(await bcrypt.compare(password, user.passwordHash)))
    throw new HttpError(400, 'Incorrect password.', { [field]: 'Incorrect password.' });
}

router.get('/me', async (req, res) => {
  res.json(profile(await current(req)));
});

// Edit name and/or email. The username is the login identity and does not change.
router.patch('/me', async (req, res) => {
  const user = await current(req);
  const { name, email } = req.body ?? {};
  if (name === undefined && email === undefined) throw new HttpError(400, 'Nothing to change.');

  const errors = {};
  if (name !== undefined && validateName(name)) errors.name = validateName(name);
  if (email !== undefined && validateEmail(email)) errors.email = validateEmail(email);
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);

  if (name !== undefined) user.name = name.trim();
  if (email !== undefined) user.email = email.trim();
  await user.save();
  res.json(profile(user));
});

// Change password. Starts a fresh session: this device stays signed in, every other device is signed out.
router.post('/me/password', async (req, res) => {
  const user = await current(req);
  const { currentPassword, newPassword } = req.body ?? {};
  await checkPassword(user, currentPassword, 'currentPassword');

  const weak = validatePassword(newPassword);
  if (weak) throw new HttpError(400, 'Please fix the highlighted fields.', { newPassword: weak });
  if (newPassword === currentPassword) throw new HttpError(400, 'Please fix the highlighted fields.', { newPassword: 'Choose a password different from the current one.' });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await startSession(res, user); // saves the new hash together with the new refresh token
  res.json({ message: 'success' });
});

// Delete the account for good (hard delete): the user, vehicles, wallet, ledger and bookings.
router.delete('/me', async (req, res) => {
  const user = await current(req);
  const { password, confirmForfeit } = req.body ?? {};
  await checkPassword(user, password, 'password');

  const busy = await Booking.exists({ user: user._id, status: { $in: ['BOOKED', 'IN_PROGRESS'] } });
  const holding = await Slot.exists({ lockedBy: user._id, status: 'SOFT_LOCKED', lockExpiresAt: { $gt: new Date() } });
  if (busy || holding)
    throw new HttpError(409, 'You still have a held bay or an active booking. Finish or cancel it first, then delete your account.');

  const wallet = await Wallet.findOne({ user: user._id });
  if (wallet?.balancePaise > 0 && confirmForfeit !== true)
    throw new HttpError(409, `Your wallet still holds ${inr(wallet.balancePaise)}, which is lost when the account is deleted. Confirm to continue.`, { confirmForfeit: 'Confirm that you give up your wallet balance.' });

  const db = await mongoose.startSession();
  try {
    await db.withTransaction(async () => {
      await Slot.updateMany({ lockedBy: user._id, status: 'SOFT_LOCKED' }, { $set: FREE }, { session: db }); // an expired hold
      await Booking.deleteMany({ user: user._id }, { session: db });
      await WalletTxn.deleteMany({ user: user._id }, { session: db });
      await Wallet.deleteOne({ user: user._id }, { session: db });
      await Vehicle.deleteMany({ owner: user._id }, { session: db });
      await User.deleteOne({ _id: user._id }, { session: db });
    });
  } finally {
    await db.endSession();
  }

  clearAccessCookie(res);
  clearLegacyRefreshCookie(res);
  res.status(204).end();
});

export default router;
