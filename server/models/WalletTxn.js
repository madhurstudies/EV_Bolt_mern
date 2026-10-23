import mongoose from 'mongoose';

// Append-only ledger: one row per money movement. amountPaise is always positive; `type` gives the direction.
//   TOPUP          money added
//   ADVANCE_DEBIT  advance paid when a booking is confirmed
//   REFUND         unused advance (or a cancelled booking) returned
export const TXN_TYPES = ['TOPUP', 'ADVANCE_DEBIT', 'REFUND'];

const txnSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: TXN_TYPES, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    balanceAfterPaise: { type: Number, required: true, min: 0 }, // snapshot, makes the statement trivial
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    note: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
txnSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('WalletTxn', txnSchema);
