import { releaseExpiredHolds } from '../services/slotService.js';
import { expireNoShows } from '../services/bookingService.js';

// Every 10s: free expired holds, and cancel + refund bookings nobody started in time.
export function startExpiryJob(intervalMs = 10000) {
  const timer = setInterval(() => {
    releaseExpiredHolds().catch((err) => console.error('hold expiry failed:', err.message));
    expireNoShows().catch((err) => console.error('no-show expiry failed:', err.message));
  }, intervalMs);
  timer.unref(); // never keeps the process alive on its own
  return timer;
}
