import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { holdSlot, releaseSlot } from '../services/slotService.js';
import { confirmSlot } from '../services/bookingService.js';
import { toRupees } from '../services/walletService.js';

const router = Router();
router.use(requireAuth);

// The user always comes from the JWT, never from the request (the template trusted ?userId=).
router.post('/:id/hold', async (req, res) => {
  const slot = await holdSlot(req.params.id, req.user.id);
  res.json({ id: slot.id, status: slot.status, holdSecondsLeft: Math.ceil((slot.lockExpiresAt - Date.now()) / 1000) });
});

// Confirming takes the advance from the wallet (402 if the balance is too low; the hold stays).
router.post('/:id/confirm', async (req, res) => {
  const { slot, booking, advancePaise, balancePaise } = await confirmSlot(req.params.id, req.user.id);
  res.json({ slotId: slot.id, bookingId: booking.id, status: slot.status, advance: toRupees(advancePaise), balance: toRupees(balancePaise) });
});

router.post('/:id/release', async (req, res) => {
  await releaseSlot(req.params.id, req.user.id);
  res.status(204).end();
});

export default router;
