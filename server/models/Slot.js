import mongoose from 'mongoose';
import { CONNECTOR_KEYS } from '../../shared/validation.js';

// AVAILABLE -> SOFT_LOCKED (held) -> BOOKED -> IN_PROGRESS (charging) -> AVAILABLE
export const SLOT_STATUS = ['AVAILABLE', 'SOFT_LOCKED', 'BOOKED', 'IN_PROGRESS'];

const slotSchema = new mongoose.Schema({
  station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true, index: true },
  slotNumber: { type: String, required: true },
  connectorType: { type: String, enum: CONNECTOR_KEYS, required: true },
  type: { type: String, enum: ['FAST', 'SLOW'] },
  powerKw: { type: Number, min: 0.5 },
  ratePerKwh: { type: Number, min: 0 }, // rupees
  status: { type: String, enum: SLOT_STATUS, default: 'AVAILABLE' },
  lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  lockExpiresAt: { type: Date, default: null },
});
slotSchema.index({ status: 1, lockExpiresAt: 1 });

export default mongoose.model('Slot', slotSchema);
