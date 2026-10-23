import { Router } from 'express';
import mongoose from 'mongoose';
import Vehicle from '../models/Vehicle.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { validateVehicle } from '../../shared/validation.js';

const router = Router();
router.use(requireAuth);

const toDto = (v) => ({
  id: v.id,
  make: v.make,
  model: v.model,
  year: v.year,
  batteryCapacityKwh: v.batteryCapacityKwh,
  maxChargingPowerKw: v.maxChargingPowerKw,
  connectorTypes: v.connectorTypes,
});

// Someone else's vehicle and a malformed id both give 404, so ids can't be probed.
async function mine(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Vehicle not found');
  const v = await Vehicle.findOne({ _id: req.params.id, owner: req.user.id });
  if (!v) throw new HttpError(404, 'Vehicle not found');
  return v;
}

router.get('/', async (req, res) => {
  const vehicles = await Vehicle.find({ owner: req.user.id }).sort({ createdAt: 1 });
  res.json(vehicles.map(toDto));
});

router.get('/:id', async (req, res) => {
  res.json(toDto(await mine(req)));
});

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const errors = validateVehicle(body);
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);

  const vehicle = await Vehicle.create({
    owner: req.user.id,
    make: body.make.trim(),
    model: body.model.trim(),
    year: Number(body.year),
    batteryCapacityKwh: Number(body.batteryCapacityKwh),
    maxChargingPowerKw: body.maxChargingPowerKw ? Number(body.maxChargingPowerKw) : null,
    connectorTypes: [...new Set(body.connectorTypes)],
  });
  res.status(201).json(toDto(vehicle));
});

// Partial update: send only what changed. The stored values and the changes are merged and
// validated with the same rules as adding a vehicle.
router.patch('/:id', async (req, res) => {
  const vehicle = await mine(req);
  const body = req.body ?? {};
  const fields = ['make', 'model', 'year', 'batteryCapacityKwh', 'maxChargingPowerKw', 'connectorTypes'];
  if (!fields.some((f) => body[f] !== undefined)) throw new HttpError(400, 'Nothing to change.');

  const merged = { ...toDto(vehicle) };
  for (const f of fields) if (body[f] !== undefined) merged[f] = body[f];

  const errors = validateVehicle(merged);
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);

  vehicle.make = String(merged.make).trim();
  vehicle.model = String(merged.model).trim();
  vehicle.year = Number(merged.year);
  vehicle.batteryCapacityKwh = Number(merged.batteryCapacityKwh);
  vehicle.maxChargingPowerKw = merged.maxChargingPowerKw ? Number(merged.maxChargingPowerKw) : null;
  vehicle.connectorTypes = [...new Set(merged.connectorTypes)];
  await vehicle.save();
  res.json(toDto(vehicle));
});

router.delete('/:id', async (req, res) => {
  const vehicle = await mine(req);
  await vehicle.deleteOne();
  res.status(204).end();
});

export default router;
