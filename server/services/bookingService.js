// Booking lifecycle with billing. Each step is one MongoDB transaction so a bay, a booking and the
// wallet can never disagree (no booked bay without a payment, no payment without a booking).
//
//   confirm : bay HELD -> BOOKED, advance taken from the wallet, booking + bill created
//   start   : BOOKED -> IN_PROGRESS (bay shows "in use")
//   finish  : IN_PROGRESS -> COMPLETED, bill settled on metered energy, unused advance refunded
//   cancel  : BOOKED -> CANCELLED, full refund      (also done automatically for no-shows)
import mongoose from 'mongoose';
import Slot from '../models/Slot.js';
import Station from '../models/Station.js';
import Booking from '../models/Booking.js';
import { HttpError } from '../middleware/error.js';
import { debit, credit } from './walletService.js';
import { FREE, checkId } from './slotService.js';

export const SESSION_HOURS = 0.5; // every booking pays for a 30-minute session up front
export const START_WINDOW_MS = 30 * 60 * 1000; // start charging within 30 min of booking or it is cancelled

export const advanceFor = (slot) => Math.round(slot.powerKw * slot.ratePerKwh * SESSION_HOURS * 100);

// Stand-in for the charger's meter: how much of the paid session was actually used (40-100%).
// Replaceable in tests. A real charger would report the energy itself.
export const meter = { fraction: () => 0.4 + Math.random() * 0.6 };

async function inTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export function confirmSlot(slotId, userId) {
  checkId(slotId);
  return inTransaction(async (session) => {
    const now = new Date();
    const slot = await Slot.findOneAndUpdate(
      { _id: slotId, status: 'SOFT_LOCKED', lockedBy: userId, lockExpiresAt: { $gt: now } },
      { $set: { status: 'BOOKED', lockExpiresAt: null } },
      { new: true, session }
    );
    if (!slot) throw new HttpError(409, 'You do not hold an active hold on this slot (it may have expired).');
    if (!slot.powerKw || slot.ratePerKwh == null) throw new HttpError(409, 'This bay has no price set yet.');

    const advance = advanceFor(slot);
    const station = await Station.findById(slot.station).select('name').session(session);
    const bookingId = new mongoose.Types.ObjectId();

    // Throws 402 if the balance is too low. That aborts the whole transaction, so the bay simply stays held.
    const wallet = await debit(userId, advance, 'ADVANCE_DEBIT', { booking: bookingId, note: `Advance for ${station?.name ?? 'booking'}`, session });

    const [booking] = await Booking.create(
      [{
        _id: bookingId,
        user: userId,
        slot: slot._id,
        station: slot.station,
        connectorType: slot.connectorType,
        chargerType: slot.type,
        powerKw: slot.powerKw,
        startBy: new Date(now.getTime() + START_WINDOW_MS),
        bill: { ratePerKwh: slot.ratePerKwh, advancePaise: advance, paymentStatus: 'PAID', paidAt: now },
      }],
      { session }
    );
    return { slot, booking, advancePaise: advance, balancePaise: wallet.balancePaise };
  });
}

// Shared by the user's cancel button and the no-show sweep. userId = null means "system".
async function cancelCore(bookingId, userId, note) {
  return inTransaction(async (session) => {
    const now = new Date();
    const filter = { _id: bookingId, status: 'BOOKED', ...(userId && { user: userId }) };
    const booking = await Booking.findOneAndUpdate(
      filter,
      { $set: { status: 'CANCELLED', cancelledAt: now, 'bill.paymentStatus': 'SETTLED', 'bill.settledAt': now, 'bill.energyKwh': 0, 'bill.amountPaise': 0 } },
      { new: true, session }
    );
    if (!booking) throw new HttpError(404, 'Active booking not found');

    const refund = booking.bill?.advancePaise ?? 0;
    booking.bill.refundPaise = refund;
    await booking.save({ session });

    await Slot.updateOne({ _id: booking.slot, status: 'BOOKED', lockedBy: booking.user }, { $set: FREE }, { session });
    if (refund > 0) await credit(booking.user, refund, 'REFUND', { booking: booking._id, note, session });
    return booking;
  });
}

export function cancelBooking(bookingId, userId) {
  checkId(bookingId, 'Booking');
  return cancelCore(bookingId, userId, 'Refund: booking cancelled');
}

export function startSession(bookingId, userId) {
  checkId(bookingId, 'Booking');
  return inTransaction(async (session) => {
    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, user: userId, status: 'BOOKED' },
      { $set: { status: 'IN_PROGRESS', startedAt: new Date() } },
      { new: true, session }
    );
    if (!booking) throw new HttpError(409, 'This booking cannot be started (it may be cancelled or already running).');
    await Slot.updateOne({ _id: booking.slot, status: 'BOOKED', lockedBy: userId }, { $set: { status: 'IN_PROGRESS' } }, { session });
    return booking;
  });
}

export function finishSession(bookingId, userId) {
  checkId(bookingId, 'Booking');
  return inTransaction(async (session) => {
    const now = new Date();
    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, user: userId, status: 'IN_PROGRESS' },
      { $set: { status: 'COMPLETED', completedAt: now } },
      { new: true, session }
    );
    if (!booking) throw new HttpError(409, 'This booking is not charging right now.');

    // Final cost = metered energy x the rate copied at booking time. The paid session is the cap, so no top-up is ever needed.
    const advance = booking.bill?.advancePaise ?? 0;
    const energyKwh = Math.round(booking.powerKw * SESSION_HOURS * meter.fraction() * 1000) / 1000;
    const amount = Math.min(advance, Math.round(energyKwh * (booking.bill?.ratePerKwh ?? 0) * 100));
    const refund = advance - amount;

    booking.bill.energyKwh = energyKwh;
    booking.bill.amountPaise = amount;
    booking.bill.refundPaise = refund;
    booking.bill.paymentStatus = 'SETTLED';
    booking.bill.settledAt = now;
    await booking.save({ session });

    await Slot.updateOne({ _id: booking.slot, status: 'IN_PROGRESS', lockedBy: userId }, { $set: FREE }, { session });
    if (refund > 0) await credit(userId, refund, 'REFUND', { booking: booking._id, note: 'Refund: unused advance', session });
    return booking;
  });
}

// Run by the 10s job: bookings nobody started in time are cancelled and refunded.
export async function expireNoShows() {
  const late = await Booking.find({ status: 'BOOKED', startBy: { $lt: new Date() } }).limit(50).select('_id');
  let n = 0;
  for (const b of late) {
    try {
      await cancelCore(b._id, null, 'Refund: booking not started in time');
      n++;
    } catch (err) {
      if (err.status !== 404) console.error('no-show cancel failed:', err.message); // 404 = user cancelled meanwhile
    }
  }
  return n;
}
