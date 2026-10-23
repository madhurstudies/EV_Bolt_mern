// Starts the real app against a throwaway database (wiped and re-seeded on every run).
import mongoose from 'mongoose';
import { createApp } from '../../server/app.js';
import { connectDb } from '../../server/config/db.js';
import { startExpiryJob } from '../../server/jobs/releaseExpiredHolds.js';
import { seedStations } from '../../server/scripts/seedData.js';

if (process.env.DB_NAME === 'ev_bolts') throw new Error('e2e server must not use the real database');

await connectDb();
await mongoose.connection.dropDatabase();
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
await seedStations();

startExpiryJob();
createApp().listen(process.env.PORT, () => console.log(`e2e server on ${process.env.PORT}, db ${process.env.DB_NAME}`));
