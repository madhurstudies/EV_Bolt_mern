import { Router } from 'express';
import Station from '../models/Station.js';
import Slot from '../models/Slot.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { advanceFor } from '../services/bookingService.js';
import { toRupees } from '../services/walletService.js';

const router = Router();
router.use(requireAuth);

// Stations nearest-first. $geoNear (2dsphere index) replaces the template's Haversine utility.
router.get('/nearby', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new HttpError(400, 'lat and lng are required numbers');

  const stations = await Station.aggregate([
    { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distanceM', spherical: true } },
  ]);
  const slots = await Slot.find({ station: { $in: stations.map((s) => s._id) } }).sort({ _id: 1 });

  const now = Date.now();
  const byStation = new Map();
  for (const s of slots) {
    const live = s.status === 'SOFT_LOCKED' && s.lockExpiresAt.getTime() > now;
    const heldByMe = live && String(s.lockedBy) === req.user.id;
    const dto = {
      id: s.id,
      slotNumber: s.slotNumber,
      connectorType: s.connectorType,
      // an expired hold counts as available even before the cleanup job runs
      status: s.status === 'SOFT_LOCKED' && !live ? 'AVAILABLE' : s.status,
      heldByMe,
      holdSecondsLeft: heldByMe ? Math.max(0, Math.ceil((s.lockExpiresAt.getTime() - now) / 1000)) : null,
      bookedByMe: (s.status === 'BOOKED' || s.status === 'IN_PROGRESS') && String(s.lockedBy) === req.user.id,
      chargerType: s.type ?? null,
      powerKw: s.powerKw ?? null,
      ratePerKwh: s.ratePerKwh ?? null,
      advance: s.powerKw && s.ratePerKwh != null ? toRupees(advanceFor(s)) : null,
    };
    const key = String(s.station);
    if (!byStation.has(key)) byStation.set(key, []);
    byStation.get(key).push(dto);
  }

  res.json(
    stations.map((st) => ({
      id: String(st._id),
      name: st.name,
      address: st.address,
      latitude: st.location.coordinates[1],
      longitude: st.location.coordinates[0],
      distanceKm: Math.round(st.distanceM / 10) / 100,
      slots: byStation.get(String(st._id)) ?? [],
    }))
  );
});

export default router;
