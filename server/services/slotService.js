// Holding a bay. Every state change is ONE conditional update, so MongoDB decides the winner
// when two users hit the same bay at the same time. (Confirming, cancelling and billing: bookingService.js)
import mongoose from 'mongoose';
import Slot from '../models/Slot.js';
import { HttpError } from '../middleware/error.js';

export const HOLD_MS = 5 * 60 * 1000;

export const FREE = { status: 'AVAILABLE', lockedBy: null, lockExpiresAt: null };

export function checkId(id, what = 'Slot') {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, `${what} not found`);
}

export async function holdSlot(slotId, userId) {
  checkId(slotId);
  const now = new Date();

  // one live hold per user (best-effort check; the atomic update below is what protects the bay)
  const other = await Slot.exists({ lockedBy: userId, status: 'SOFT_LOCKED', lockExpiresAt: { $gt: now }, _id: { $ne: slotId } });
  if (other) throw new HttpError(409, 'You already hold another slot. Confirm or release it first.');

  const slot = await Slot.findOneAndUpdate(
    {
      _id: slotId,
      $or: [{ status: 'AVAILABLE' }, { status: 'SOFT_LOCKED', lockExpiresAt: { $lt: now } }], // expired holds are free
    },
    { $set: { status: 'SOFT_LOCKED', lockedBy: userId, lockExpiresAt: new Date(now.getTime() + HOLD_MS) } },
    { new: true }
  );
  if (!slot) {
    if (!(await Slot.exists({ _id: slotId }))) throw new HttpError(404, 'Slot not found');
    throw new HttpError(409, 'Slot is no longer available');
  }
  return slot;
}

// Only the holder can release; releasing something you don't hold is a harmless no-op.
export async function releaseSlot(slotId, userId) {
  checkId(slotId);
  await Slot.updateOne({ _id: slotId, status: 'SOFT_LOCKED', lockedBy: userId }, { $set: FREE });
}

// Called every 10s by the background job (replaces the template's @Scheduled task)
export async function releaseExpiredHolds() {
  const r = await Slot.updateMany({ status: 'SOFT_LOCKED', lockExpiresAt: { $lt: new Date() } }, { $set: FREE });
  return r.modifiedCount;
}
