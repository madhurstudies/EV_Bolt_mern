import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, setupDb, teardownDb, signedInAgent, firstSlot, fund, PASSWORD } from '../helpers.js';
import User from '../../server/models/User.js';
import Vehicle from '../../server/models/Vehicle.js';
import Booking from '../../server/models/Booking.js';
import Wallet from '../../server/models/Wallet.js';
import WalletTxn from '../../server/models/WalletTxn.js';

before(() => setupDb());
after(() => teardownDb());

const car = { make: 'Tata', model: 'Nexon EV', year: 2023, batteryCapacityKwh: 40.5, maxChargingPowerKw: 50, connectorTypes: ['CCS2'] };
const addCar = async (agent, over = {}) => (await agent.post('/api/vehicles').send({ ...car, ...over })).body;

/* ---------------- Vehicles ---------------- */

test('vehicle: read one, edit part of it, and the rest stays as it was', async () => {
  const { agent } = await signedInAgent('veh');
  const v = await addCar(agent);

  const one = await agent.get(`/api/vehicles/${v.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.model, 'Nexon EV');

  const edit = await agent.patch(`/api/vehicles/${v.id}`).send({ model: 'Nexon Max', connectorTypes: ['CCS2', 'TYPE_2'], maxChargingPowerKw: '' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.model, 'Nexon Max');
  assert.deepEqual(edit.body.connectorTypes, ['CCS2', 'TYPE_2']);
  assert.equal(edit.body.maxChargingPowerKw, null); // cleared
  assert.equal(edit.body.make, 'Tata'); // untouched
  assert.equal(edit.body.year, 2023);

  const list = (await agent.get('/api/vehicles')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].model, 'Nexon Max');
});

test('vehicle edit uses the same rules as adding one', async () => {
  const { agent } = await signedInAgent('veh');
  const v = await addCar(agent);
  const bad = await agent.patch(`/api/vehicles/${v.id}`).send({ year: 1999, batteryCapacityKwh: -5, make: '  ', connectorTypes: [] });
  assert.equal(bad.status, 400);
  for (const f of ['year', 'batteryCapacityKwh', 'make', 'connectorTypes']) assert.ok(bad.body.errors[f], f);
  assert.equal((await agent.patch(`/api/vehicles/${v.id}`).send({})).status, 400); // nothing to change
  assert.equal((await agent.get(`/api/vehicles/${v.id}`)).body.year, 2023); // unchanged
});

test('vehicle delete removes it for good', async () => {
  const { agent } = await signedInAgent('veh');
  const v = await addCar(agent);
  assert.equal((await agent.delete(`/api/vehicles/${v.id}`)).status, 204);
  assert.equal((await agent.get(`/api/vehicles/${v.id}`)).status, 404);
  assert.equal((await agent.get('/api/vehicles')).body.length, 0);
  assert.equal(await Vehicle.countDocuments({ _id: v.id }), 0);
});

test("someone else's vehicle (or a bad id) is 404 for read, edit and delete", async () => {
  const owner = await signedInAgent('own');
  const other = await signedInAgent('oth');
  const v = await addCar(owner.agent);
  for (const [method, body] of [['get'], ['patch', { model: 'Hacked' }], ['delete']]) {
    assert.equal((await other.agent[method](`/api/vehicles/${v.id}`).send(body)).status, 404, method);
    assert.equal((await other.agent[method]('/api/vehicles/not-an-id').send(body)).status, 404, `${method} bad id`);
  }
  assert.equal((await owner.agent.get(`/api/vehicles/${v.id}`)).body.model, 'Nexon EV'); // untouched
  assert.equal((await request(app).delete(`/api/vehicles/${v.id}`)).status, 401);
});

/* ---------------- Profile ---------------- */

test('profile: edit name and email; the username cannot be changed', async () => {
  const { agent, username } = await signedInAgent('prof');
  const res = await agent.patch('/api/users/me').send({ name: '  Asha K  ', email: 'asha@mail.in', username: 'hacker' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Asha K');
  assert.equal(res.body.email, 'asha@mail.in');
  assert.equal(res.body.username, username);
  assert.equal((await agent.get('/api/users/me')).body.name, 'Asha K');

  assert.equal((await agent.patch('/api/users/me').send({ email: '' })).body.email, ''); // email is optional
});

test('profile: invalid values are 400 and change nothing', async () => {
  const { agent } = await signedInAgent('prof');
  const bad = await agent.patch('/api/users/me').send({ name: '   ', email: 'not-an-email' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.name && bad.body.errors.email);
  assert.equal((await agent.patch('/api/users/me').send({})).status, 400);
  assert.equal((await agent.get('/api/users/me')).body.name, 'Test User');
});

/* ---------------- Password ---------------- */

const expiredFor = (cookieHeader) => {
  const token = cookieHeader.find((c) => c.startsWith('access_token=')).split(';')[0].slice('access_token='.length);
  const c = jwt.decode(token);
  return jwt.sign({ sub: c.sub, username: c.username, sid: c.sid }, process.env.JWT_ACCESS_SECRET, { expiresIn: -60 });
};

test('password: wrong current, weak new and unchanged passwords are rejected with field errors', async () => {
  const { agent } = await signedInAgent('pw');
  const wrong = await agent.post('/api/users/me/password').send({ currentPassword: 'nope', newPassword: 'Brand-new1!' });
  assert.equal(wrong.status, 400); // 400 and not 401, so the browser does not bounce to the login page
  assert.ok(wrong.body.errors.currentPassword);

  const weak = await agent.post('/api/users/me/password').send({ currentPassword: PASSWORD, newPassword: 'short' });
  assert.ok(weak.body.errors.newPassword);
  const same = await agent.post('/api/users/me/password').send({ currentPassword: PASSWORD, newPassword: PASSWORD });
  assert.ok(same.body.errors.newPassword);
  assert.equal((await agent.get('/api/users/me')).status, 200);
});

test('password change: new one works, old one stops, this device stays in, other devices are signed out', async () => {
  const { agent, username } = await signedInAgent('pw');
  const other = await request(app).post('/api/auth/login').send({ username, password: PASSWORD }); // a second device
  const otherExpired = expiredFor(other.headers['set-cookie']);

  const NEW = 'Brand-new1!';
  const res = await agent.post('/api/users/me/password').send({ currentPassword: PASSWORD, newPassword: NEW });
  assert.equal(res.status, 200);

  assert.equal((await request(app).post('/api/auth/login').send({ username, password: PASSWORD })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ username, password: NEW })).status, 200);

  // the second device can no longer refresh once its access token expires
  assert.equal((await request(app).get('/api/users/me').set('Cookie', `access_token=${otherExpired}`)).status, 401);
});

test('password change keeps this device signed in even after its access token expires', async () => {
  const { agent, username } = await signedInAgent('pw');
  const res = await agent.post('/api/users/me/password').send({ currentPassword: PASSWORD, newPassword: 'Brand-new1!' });
  const expired = expiredFor(res.headers['set-cookie']);
  assert.equal((await request(app).get('/api/users/me').set('Cookie', `access_token=${expired}`)).status, 200);
  assert.ok(username);
});

/* ---------------- Delete account ---------------- */

const idOf = async (username) => (await User.findOne({ username }))?._id;

test('delete account: needs the right password', async () => {
  const { agent, username } = await signedInAgent('del');
  const res = await agent.delete('/api/users/me').send({ password: 'wrong' });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.password);
  assert.ok(await idOf(username));
  assert.equal((await agent.delete('/api/users/me').send({})).status, 400);
});

test('delete account: refused while a bay is held or a booking is active', async () => {
  const { agent, username } = await signedInAgent('del');
  await fund(agent, 2000);
  const { slot } = await firstSlot(agent, 'CCS2');
  await agent.post(`/api/slots/${slot.id}/hold`);
  const held = await agent.delete('/api/users/me').send({ password: PASSWORD, confirmForfeit: true });
  assert.equal(held.status, 409);
  assert.match(held.body.message, /held bay or an active booking/);

  await agent.post(`/api/slots/${slot.id}/confirm`);
  assert.equal((await agent.delete('/api/users/me').send({ password: PASSWORD, confirmForfeit: true })).status, 409);
  assert.ok(await idOf(username));

  // after cancelling, it is allowed
  const [b] = (await agent.get('/api/bookings')).body;
  await agent.post(`/api/bookings/${b.id}/cancel`);
  assert.equal((await agent.delete('/api/users/me').send({ password: PASSWORD, confirmForfeit: true })).status, 204);
});

test('delete account: wallet money must be given up knowingly', async () => {
  const { agent, username } = await signedInAgent('del');
  await fund(agent, 500);
  const refused = await agent.delete('/api/users/me').send({ password: PASSWORD });
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, /₹500\.00/);
  assert.ok(await idOf(username));
  assert.equal((await agent.delete('/api/users/me').send({ password: PASSWORD, confirmForfeit: true })).status, 204);
});

test('delete account removes the user, vehicles, wallet, ledger and bookings, and ends the session', async () => {
  const { agent, username } = await signedInAgent('gone');
  await addCar(agent);
  await fund(agent, 2000);
  const { slot } = await firstSlot(agent, 'CCS2');
  await agent.post(`/api/slots/${slot.id}/hold`);
  await agent.post(`/api/slots/${slot.id}/confirm`);
  const [b] = (await agent.get('/api/bookings')).body;
  await agent.post(`/api/bookings/${b.id}/start`);
  await agent.post(`/api/bookings/${b.id}/finish`); // a completed booking, with a bill
  const id = await idOf(username);
  assert.equal(await Booking.countDocuments({ user: id }), 1);

  const res = await agent.delete('/api/users/me').send({ password: PASSWORD, confirmForfeit: true });
  assert.equal(res.status, 204);
  assert.match(res.headers['set-cookie'].find((c) => c.startsWith('access_token=')), /Expires=Thu, 01 Jan 1970/);

  assert.equal(await User.countDocuments({ _id: id }), 0);
  assert.equal(await Vehicle.countDocuments({ owner: id }), 0);
  assert.equal(await Wallet.countDocuments({ user: id }), 0);
  assert.equal(await WalletTxn.countDocuments({ user: id }), 0);
  assert.equal(await Booking.countDocuments({ user: id }), 0);
  assert.equal((await request(app).post('/api/auth/login').send({ username, password: PASSWORD })).status, 401);
  assert.equal((await agent.get('/api/users/me')).status, 401);
});

