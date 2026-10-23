import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { connectDb, disconnectDb } from '../server/config/db.js';
import { seedStations } from '../server/scripts/seedData.js';

export const PASSWORD = 'Passw0rd!x';
export const app = createApp();

// Tests wipe their database, so they only ever run against a dedicated test DB.
export async function setupDb(name = 'ev_bolts_test') {
  process.env.DB_NAME = name;
  if (name === 'ev_bolts') throw new Error('Refusing to run tests against the real database');
  await connectDb();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await seedStations();
}

export async function teardownDb() {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
}

let n = 0;
// A signed-in supertest agent (keeps the cookies like a browser would).
export async function signedInAgent(prefix = 'user') {
  const agent = request.agent(app);
  const username = `${prefix}_${Date.now().toString(36)}${n++}`.slice(0, 20);
  const res = await agent.post('/api/auth/signup').send({ name: 'Test User', username, email: `${username}@example.com`, password: PASSWORD });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, username };
}

// Demo top-up so a user can pay the advance when confirming.
export async function fund(agent, amount = 2000) {
  const res = await agent.post('/api/wallet/topup').send({ amount });
  if (res.status !== 201) throw new Error(`topup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.balance;
}


export async function firstSlot(agent, connectorType) {
  const res = await agent.get('/api/stations/nearby?lat=18.5204&lng=73.8567');
  for (const st of res.body) {
    const slot = st.slots.find((s) => s.status === 'AVAILABLE' && (!connectorType || s.connectorType === connectorType));
    if (slot) return { slot, station: st };
  }
  throw new Error('no free slot');
}
