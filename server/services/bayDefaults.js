// Default speed and price for each connector type. Used by the seed and to backfill older bays.
import Slot from '../models/Slot.js';

export const BAY_DEFAULTS = {
  CCS2: { type: 'FAST', powerKw: 60, ratePerKwh: 18 },
  CCS1: { type: 'FAST', powerKw: 50, ratePerKwh: 18 },
  CHADEMO: { type: 'FAST', powerKw: 50, ratePerKwh: 18 },
  GB_T: { type: 'FAST', powerKw: 60, ratePerKwh: 18 },
  BHARAT_DC_001: { type: 'FAST', powerKw: 30, ratePerKwh: 16 },
  TESLA: { type: 'FAST', powerKw: 120, ratePerKwh: 22 },
  TYPE_2: { type: 'SLOW', powerKw: 7.4, ratePerKwh: 12 },
  TYPE_1: { type: 'SLOW', powerKw: 7.4, ratePerKwh: 12 },
  BHARAT_AC_001: { type: 'SLOW', powerKw: 3.3, ratePerKwh: 10 },
};

// Idempotent: only touches bays that have no price yet (created before billing existed).
export async function backfillBays() {
  let n = 0;
  for (const [connectorType, d] of Object.entries(BAY_DEFAULTS)) {
    const r = await Slot.updateMany({ connectorType, powerKw: { $exists: false } }, { $set: d });
    n += r.modifiedCount;
  }
  return n;
}
