import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, setupDb, teardownDb, signedInAgent } from '../helpers.js';

before(() => setupDb());
after(() => teardownDb());

const good = { make: 'Tata', model: 'Nexon EV', year: 2023, batteryCapacityKwh: 40.5, connectorTypes: ['CCS2'] };

test('vehicle endpoints need a login', async () => {
  assert.equal((await request(app).get('/api/vehicles')).status, 401);
  assert.equal((await request(app).post('/api/vehicles').send(good)).status, 401);
});

test('add a vehicle, then list it', async () => {
  const { agent } = await signedInAgent('veh');
  const created = await agent.post('/api/vehicles').send(good);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.connectorTypes, ['CCS2']);
  const list = await agent.get('/api/vehicles');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].model, 'Nexon EV');
});

test('invalid vehicles are 400 with field errors', async () => {
  const { agent } = await signedInAgent('veh');
  const res = await agent.post('/api/vehicles').send({ make: '', model: 'X', year: 1999, batteryCapacityKwh: -1, connectorTypes: ['NOPE'] });
  assert.equal(res.status, 400);
  for (const f of ['make', 'year', 'batteryCapacityKwh', 'connectorTypes']) assert.ok(res.body.errors[f], f);
});

test("a user never sees someone else's vehicles", async () => {
  const a = await signedInAgent('ownr');
  const b = await signedInAgent('othr');
  await a.agent.post('/api/vehicles').send(good);
  assert.equal((await b.agent.get('/api/vehicles')).body.length, 0);
});

test('nearby stations are sorted nearest-first with distances and slots', async () => {
  const { agent } = await signedInAgent('geo');
  // standing in Baner: Baner Highstreet must come first
  const res = await agent.get('/api/stations/nearby?lat=18.559&lng=73.7868');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 8);
  assert.equal(res.body[0].name, 'Baner Highstreet Charge');
  const d = res.body.map((s) => s.distanceKm);
  assert.deepEqual(d, [...d].sort((x, y) => x - y));
  assert.ok(res.body.every((s) => s.slots.length > 0));
  assert.equal(JSON.stringify(res.body).includes('lockedBy'), false, 'must not leak other users');
});

test('nearby rejects bad coordinates', async () => {
  const { agent } = await signedInAgent('geo');
  assert.equal((await agent.get('/api/stations/nearby?lat=abc&lng=1')).status, 400);
  assert.equal((await agent.get('/api/stations/nearby?lat=95&lng=1')).status, 400);
});
