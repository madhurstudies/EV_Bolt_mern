import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, setupDb, teardownDb, signedInAgent, firstSlot, fund } from '../helpers.js';
import Booking from '../../server/models/Booking.js';
import Slot from '../../server/models/Slot.js';
import { meter, expireNoShows } from '../../server/services/bookingService.js';

before(() => setupDb());
after(() => teardownDb());
beforeEach(() => { meter.fraction = () => 0.5; }); // deterministic "charger meter": half of the paid session is used

// A CCS2 bay is FAST, 60 kW, Rs 18/kWh -> advance = 60 kW x 0.5 h x 18 = Rs 540
const ADVANCE = 540;

const balance = async (agent) => (await agent.get('/api/wallet')).body.balance;
const hold = async (agent) => {
  const { slot } = await firstSlot(agent, 'CCS2');
  assert.equal((await agent.post(`/api/slots/${slot.id}/hold`)).status, 200);
  return slot;
};

test('a new account has an empty wallet', async () => {
  const { agent } = await signedInAgent('w');
  const w = await agent.get('/api/wallet');
  assert.equal(w.status, 200);
  assert.equal(w.body.balance, 0);
  assert.deepEqual(w.body.transactions, []);
  assert.equal((await request(app).get('/api/wallet')).status, 401);
});

test('top-up validates the amount', async () => {
  const { agent } = await signedInAgent('w');
  for (const amount of [5, 50001, 100.5, 'abc', undefined]) {
    assert.equal((await agent.post('/api/wallet/topup').send({ amount })).status, 400, String(amount));
  }
  assert.equal(await balance(agent), 0);
});

test('10 parallel top-ups all land: balance is the exact sum and every one is in the ledger', async () => {
  const { agent } = await signedInAgent('w');
  const results = await Promise.all(Array.from({ length: 10 }, () => agent.post('/api/wallet/topup').send({ amount: 100 })));
  assert.ok(results.every((r) => r.status === 201));
  const w = (await agent.get('/api/wallet')).body;
  assert.equal(w.balance, 1000);
  assert.equal(w.transactions.filter((t) => t.type === 'TOPUP').length, 10);
});

test('confirm with too little money: 402, hold is kept, nothing is charged or booked', async () => {
  const { agent } = await signedInAgent('poor');
  await fund(agent, 100);
  const slot = await hold(agent);
  const res = await agent.post(`/api/slots/${slot.id}/confirm`);
  assert.equal(res.status, 402);
  assert.match(res.body.message, /540/);
  assert.equal(await balance(agent), 100);
  assert.equal((await agent.get('/api/bookings')).body.length, 0);
  assert.equal((await Slot.findById(slot.id)).status, 'SOFT_LOCKED'); // still held, so they can top up and retry

  await fund(agent, 500);
  assert.equal((await agent.post(`/api/slots/${slot.id}/confirm`)).status, 200);
  assert.equal(await balance(agent), 600 - ADVANCE);
});

test('confirm takes the advance and writes the ledger and the bill', async () => {
  const { agent } = await signedInAgent('pay');
  await fund(agent, 2000);
  const slot = await hold(agent);
  assert.equal(slot.advance, ADVANCE); // the board shows the price before you hold
  const res = await agent.post(`/api/slots/${slot.id}/confirm`);
  assert.equal(res.status, 200);
  assert.equal(res.body.advance, ADVANCE);
  assert.equal(res.body.balance, 2000 - ADVANCE);

  const w = (await agent.get('/api/wallet')).body;
  assert.equal(w.transactions[0].type, 'ADVANCE_DEBIT');
  assert.equal(w.transactions[0].amount, ADVANCE);
  assert.equal(w.transactions[0].balanceAfter, 2000 - ADVANCE);

  const [b] = (await agent.get('/api/bookings')).body;
  assert.equal(b.status, 'BOOKED');
  assert.equal(b.bill.advance, ADVANCE);
  assert.equal(b.bill.ratePerKwh, 18);
  assert.equal(b.bill.paymentStatus, 'PAID');
});

test('confirming the same hold twice in parallel charges only once', async () => {
  const { agent } = await signedInAgent('dbl');
  await fund(agent, 2000);
  const slot = await hold(agent);
  const [a, b] = await Promise.all([agent.post(`/api/slots/${slot.id}/confirm`), agent.post(`/api/slots/${slot.id}/confirm`)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(await balance(agent), 2000 - ADVANCE);
  assert.equal((await agent.get('/api/bookings')).body.length, 1);
});

test('cancel refunds the full advance and frees the bay', async () => {
  const { agent } = await signedInAgent('cnl');
  await fund(agent, 2000);
  const slot = await hold(agent);
  await agent.post(`/api/slots/${slot.id}/confirm`);
  const [b] = (await agent.get('/api/bookings')).body;

  const res = await agent.post(`/api/bookings/${b.id}/cancel`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'CANCELLED');
  assert.equal(res.body.bill.refund, ADVANCE);
  assert.equal(res.body.bill.amount, 0);
  assert.equal(await balance(agent), 2000);
  assert.equal((await Slot.findById(slot.id)).status, 'AVAILABLE');
  assert.equal((await agent.get('/api/wallet')).body.transactions[0].type, 'REFUND');
});

test('start then finish settles on metered energy and refunds the unused advance', async () => {
  const { agent } = await signedInAgent('chg');
  await fund(agent, 2000);
  const slot = await hold(agent);
  await agent.post(`/api/slots/${slot.id}/confirm`);
  const [b] = (await agent.get('/api/bookings')).body;

  assert.equal((await agent.post(`/api/bookings/${b.id}/finish`)).status, 409); // not started yet
  const started = await agent.post(`/api/bookings/${b.id}/start`);
  assert.equal(started.status, 200);
  assert.equal(started.body.status, 'IN_PROGRESS');
  assert.equal((await Slot.findById(slot.id)).status, 'IN_PROGRESS');
  assert.equal((await agent.post(`/api/bookings/${b.id}/start`)).status, 409); // already running
  assert.equal((await agent.post(`/api/bookings/${b.id}/cancel`)).status, 404); // too late to cancel

  const done = await agent.post(`/api/bookings/${b.id}/finish`);
  assert.equal(done.status, 200);
  // 60 kW x 0.5 h x 50% = 15 kWh at Rs 18 = Rs 270 used, Rs 270 back
  assert.equal(done.body.status, 'COMPLETED');
  assert.equal(done.body.bill.energyKwh, 15);
  assert.equal(done.body.bill.amount, 270);
  assert.equal(done.body.bill.refund, 270);
  assert.equal(done.body.bill.advance, done.body.bill.amount + done.body.bill.refund); // always adds up
  assert.equal(done.body.bill.paymentStatus, 'SETTLED');
  assert.equal(await balance(agent), 2000 - 270);
  assert.equal((await Slot.findById(slot.id)).status, 'AVAILABLE');
});

test("nobody else can start, finish or cancel my booking", async () => {
  const me = await signedInAgent('mine');
  const other = await signedInAgent('oth');
  await fund(me.agent, 2000);
  const slot = await hold(me.agent);
  await me.agent.post(`/api/slots/${slot.id}/confirm`);
  const [b] = (await me.agent.get('/api/bookings')).body;
  assert.equal((await other.agent.post(`/api/bookings/${b.id}/start`)).status, 409);
  assert.equal((await other.agent.post(`/api/bookings/${b.id}/cancel`)).status, 404);
  assert.equal((await Booking.findById(b.id)).status, 'BOOKED');
});

test('a booking nobody starts in time is cancelled and refunded by the sweep', async () => {
  const { agent } = await signedInAgent('late');
  await fund(agent, 2000);
  const slot = await hold(agent);
  await agent.post(`/api/slots/${slot.id}/confirm`);
  const [b] = (await agent.get('/api/bookings')).body;
  await Booking.updateOne({ _id: b.id }, { $set: { startBy: new Date(Date.now() - 1000) } });

  assert.ok((await expireNoShows()) >= 1);
  const after = (await agent.get('/api/bookings')).body[0];
  assert.equal(after.status, 'CANCELLED');
  assert.equal(after.bill.refund, ADVANCE);
  assert.equal(await balance(agent), 2000);
  assert.equal((await Slot.findById(slot.id)).status, 'AVAILABLE');
});
