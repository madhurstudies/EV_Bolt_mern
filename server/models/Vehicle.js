import mongoose from 'mongoose';
import { CONNECTOR_KEYS, YEAR_MIN, YEAR_MAX } from '../../shared/validation.js';

const vehicleSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    make: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    year: { type: Number, required: true, min: YEAR_MIN, max: YEAR_MAX },
    batteryCapacityKwh: { type: Number, required: true, min: 0.1 },
    maxChargingPowerKw: { type: Number, min: 0.1, default: null },
    // embedded array: replaces the template's vehicle_connectors join table
    connectorTypes: {
      type: [{ type: String, enum: CONNECTOR_KEYS }],
      validate: (v) => v.length > 0,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Vehicle', vehicleSchema);
