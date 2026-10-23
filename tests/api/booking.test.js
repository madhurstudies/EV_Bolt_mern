import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, teardownDb, signedInAgent, firstSlot, fund } from '../helpers.js';
import Slot from '../../server/models/Slot.js';
import { releaseExpiredHolds } from '../../server/services/slotService.js';

before(() => setupDb());
after(() => teardownDb());

const slotState = async (agent, id) => {
  const res = await agent.get('/api/stations/nearby?lat=18.5204&lng=73.8567');
  return res.body.flatMap((s) => s.slots).find((s) => s.id === id);
};

test('20 users race for ONE slot: exactly one wins, nineteen get 409', async () => {
  const users = await Promise.all(Array.from({ length: 20 }, (_, i) => signedInAgent(`race${i}`)));
  const { slot } = await firstSlot(users[0].agent);

  const results = await Promise.all(users.map((u) => u.agent.post(`/api/slots/${slot.id}/hold`)));
  const codes = results.map((r) => r.status).sort();
  assert.equal(codes.filter((c) => c === 200).length, 1, `codes: ${codes}`);
  assert.equal(codes.filter((c) => c === 409).length, 19, `codes: ${codes}`);

  assert.equal(await Slot.countDocuments({ _id: slot.id, status: 'SOFT_LOCKED' }), 1);
});

test('hold → confirm creates a booking; the slot shows BOOKED', async () => {
  const { agent } = await signedInAgent('book');
  const { slot } = await firstSlot(agent);
  assert.equal((await agent.post(`/api/slots/${slot.id}/hold`)).status, 200);
  const mine = await slotState(agent, slot.id);
  assert.equal(mine.heldByMe, true);
  assert.ok(mine.holdSecondsLeft > 280 && mine.holdSecondsLeft <= 300);

  await fund(agent);
  const confirm = await agent.post(`/api/slots/${slot.id}/confirm`);
  assert.equal(confirm.status, 200);
  assert.equal((await slotState(agent, slot.id)).status, 'BOOKED');

  const bookings = await agent.get('/api/bookings');
  assert.equal(bookings.body.length, 1);
  assert.equal(bookings.body[0].status, 'BOOKED');
  assert.ok(bookings.body[0].stationName);
});

test("someone else cannot confirm or release my hold", async () => {
  const me = await signedInAgent('mine');
  const other = await signedInAgent('thief');
  const { slot } = await firstSlot(me.agent);
  await me.agent.post(`/api/slots/${slot.id}/hold`);

  assert.equal((await other.agent.post(`/api/slots/${slot.id}/confirm`)).status, 409);
  await other.agent.post(`/api/slots/${slot.id}/release`); // no-op for a non-holder
  assert.equal((await slotState(me.agent, slot.id)).heldByMe, true);
  assert.equal((await other.agent.post(`/api/slots/${slot.id}/hold`)).status, 409);
});

test('release frees the slot for others', async () => {
  const a = await signedInAgent('rel');
  const b = await signedInAgent('nxt');
  const { slot } = await firstSlot(a.agent);
  await a.agent.post(`/api/slots/${slot.id}/hold`);
  assert.equal((await a.agent.post(`/api/slots/${slot.id}/release`)).status, 204);
  assert.equal((await b.agent.post(`/api/slots/${slot.id}/hold`)).status, 200);
});

test('a user can hold only one slot at a time', async () => {
  const { agent } = await signedInAgent('one');
  const res = await agent.get('/api/stations/nearby?lat=18.5204&lng=73.8567');
  const free = res.body.flatMap((s) => s.slots).filter((s) => s.status === 'AVAILABLE');
  assert.equal((await agent.post(`/api/slots/${free[0].id}/hold`)).status, 200);
  assert.equal((await agent.post(`/api/slots/${free[1].id}/hold`)).status, 409);
});

test('expired hold: shown free at once, swept by the job, and re-holdable; confirm fails', async () => {
  const a = await signedInAgent('exp');
  const b = await signedInAgent('late');
  const { slot } = await firstSlot(a.agent);
  await a.agent.post(`/api/slots/${slot.id}/hold`);
  await Slot.updateOne({ _id: slot.id }, { $set: { lockExpiresAt: new Date(Date.now() - 1000) } });

  assert.equal((await slotState(b.agent, slot.id)).status, 'AVAILABLE'); // lazy expiry
  assert.equal((await a.agent.post(`/api/slots/${slot.id}/confirm`)).status, 409); // too late

  assert.ok((await releaseExpiredHolds()) >= 1); // the 10s job
  assert.equal((await Slot.findById(slot.id)).status, 'AVAILABLE');
  assert.equal((await b.agent.post(`/api/slots/${slot.id}/hold`)).status, 200);
});

test('cancel frees the slot and marks the booking CANCELLED', async () => {
  const { agent } = await signedInAgent('cncl');
  const { slot } = await firstSlot(agent);
  await fund(agent);
  await agent.post(`/api/slots/${slot.id}/hold`);
  await agent.post(`/api/slots/${slot.id}/confirm`);
  const [booking] = (await agent.get('/api/bookings')).body;

  assert.equal((await agent.post(`/api/bookings/${booking.id}/cancel`)).status, 200);
  assert.equal((await slotState(agent, slot.id)).status, 'AVAILABLE');
  assert.equal((await agent.get('/api/bookings')).body[0].status, 'CANCELLED');
  assert.equal((await agent.post(`/api/bookings/${booking.id}/cancel`)).status, 404); // already cancelled
});

test("nobody can cancel someone else's booking", async () => {
  const owner = await signedInAgent('own');
  const intruder = await signedInAgent('int');
  const { slot } = await firstSlot(owner.agent);
  await fund(owner.agent);
  await owner.agent.post(`/api/slots/${slot.id}/hold`);
  await owner.agent.post(`/api/slots/${slot.id}/confirm`);
  const [booking] = (await owner.agent.get('/api/bookings')).body;
  assert.equal((await intruder.agent.post(`/api/bookings/${booking.id}/cancel`)).status, 404);
  assert.equal((await slotState(owner.agent, slot.id)).status, 'BOOKED');
});

test('unknown / malformed slot ids are 404, not 500', async () => {
  const { agent } = await signedInAgent('bad');
  assert.equal((await agent.post('/api/slots/not-an-id/hold')).status, 404);
  assert.equal((await agent.post('/api/slots/64b000000000000000000000/hold')).status, 404);
});
