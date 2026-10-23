import { Router } from 'express';
import Booking from '../models/Booking.js';
import { requireAuth } from '../middleware/auth.js';
import { cancelBooking, startSession, finishSession } from '../services/bookingService.js';
import { toRupees } from '../services/walletService.js';

const router = Router();
router.use(requireAuth);

const money = (p) => (p == null ? null : toRupees(p));

export const toDto = (b) => ({
  id: b.id,
  status: b.status,
  createdAt: b.createdAt,
  startBy: b.startBy,
  startedAt: b.startedAt,
  completedAt: b.completedAt,
  cancelledAt: b.cancelledAt,
  connectorType: b.connectorType,
  chargerType: b.chargerType ?? null,
  powerKw: b.powerKw ?? null,
  stationName: b.station?.name ?? 'Unknown station',
  stationAddress: b.station?.address ?? '',
  slotNumber: b.slot?.slotNumber ?? '-',
  bill: {
    ratePerKwh: b.bill?.ratePerKwh ?? null,
    advance: money(b.bill?.advancePaise ?? 0),
    energyKwh: b.bill?.energyKwh ?? null,
    amount: money(b.bill?.amountPaise),
    refund: money(b.bill?.refundPaise),
    paymentStatus: b.bill?.paymentStatus ?? null,
  },
});

const load = (id) => Booking.findById(id).populate('station', 'name address').populate('slot', 'slotNumber');

router.get('/', async (req, res) => {
  const bookings = await Booking.find({ user: req.user.id }).sort({ createdAt: -1 }).populate('station', 'name address').populate('slot', 'slotNumber');
  res.json(bookings.map(toDto));
});

router.post('/:id/cancel', async (req, res) => {
  const b = await cancelBooking(req.params.id, req.user.id);
  res.json(toDto(await load(b.id)));
});

router.post('/:id/start', async (req, res) => {
  const b = await startSession(req.params.id, req.user.id);
  res.json(toDto(await load(b.id)));
});

router.post('/:id/finish', async (req, res) => {
  const b = await finishSession(req.params.id, req.user.id);
  res.json(toDto(await load(b.id)));
});

export default router;
