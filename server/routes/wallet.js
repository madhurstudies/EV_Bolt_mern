import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { topup, walletView, toRupees } from '../services/walletService.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await walletView(req.user.id));
});

// Demo top-up (no real payment). Body: { amount: <whole rupees> }
router.post('/topup', async (req, res) => {
  const wallet = await topup(req.user.id, req.body?.amount);
  res.status(201).json({ balance: toRupees(wallet.balancePaise) });
});

export default router;
