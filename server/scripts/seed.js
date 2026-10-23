// Seeds Pune charging stations and slots. Safe to re-run: skips if stations exist.
// `npm run seed -- --reset` wipes stations and slots first.
import { connectDb, disconnectDb } from '../config/db.js';
import Station from '../models/Station.js';
import Slot from '../models/Slot.js';
import { STATIONS, seedStations } from './seedData.js';

try {
  await connectDb();
  if (process.argv.includes('--reset')) {
    await Slot.deleteMany({});
    await Station.deleteMany({});
    console.log('Cleared stations and slots.');
  }
  if (await Station.countDocuments()) {
    console.log('Stations already exist, skipping. Use `npm run seed -- --reset` to re-seed.');
  } else {
    await seedStations();
    const slots = STATIONS.reduce((n, s) => n + s.slots.length, 0);
    console.log(`Seeded ${STATIONS.length} stations and ${slots} slots.`);
  }
  await disconnectDb();
} catch (err) {
  console.error('Seed failed:', err.message);
  process.exit(1);
}
