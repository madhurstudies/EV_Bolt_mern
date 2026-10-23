import mongoose from 'mongoose';

// BOOKED -> IN_PROGRESS -> COMPLETED, or BOOKED -> CANCELLED
const bookingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    slot: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot', required: true },
    station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
    connectorType: { type: String, required: true },
    chargerType: { type: String, enum: ['FAST', 'SLOW'] }, // copied from the bay at booking time
    powerKw: { type: Number },
    status: { type: String, enum: ['BOOKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], default: 'BOOKED' },
    startBy: { type: Date, default: null }, // a booking not started by then is cancelled and refunded
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    // The bill lives on the booking (1:1). The rate is COPIED so a later price change never rewrites it.
    bill: {
      ratePerKwh: Number,
      advancePaise: { type: Number, default: 0 },
      energyKwh: Number,
      amountPaise: Number, // final cost = energy x rate, never more than the advance
      refundPaise: Number,
      paymentStatus: { type: String, enum: ['PAID', 'SETTLED'] }, // PAID = advance taken, SETTLED = session over
      paidAt: Date,
      settledAt: Date,
    },
  },
  { timestamps: true }
);
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ status: 1, startBy: 1 });

export default mongoose.model('Booking', bookingSchema);
