import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { startExpiryJob } from './jobs/releaseExpiredHolds.js';
import { backfillBays } from './services/bayDefaults.js';

const port = process.env.PORT || 3000;

await connectDb();
console.log('MongoDB connected');
const filled = await backfillBays(); // bays created before billing existed get a default speed and price
if (filled) console.log(`Backfilled price/power on ${filled} bays`);
startExpiryJob();
createApp().listen(port, () => console.log(`EV.Bolts running on http://localhost:${port}`));
