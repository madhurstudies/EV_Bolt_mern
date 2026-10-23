import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import vehicleRoutes from './routes/vehicles.js';
import stationRoutes from './routes/stations.js';
import slotRoutes from './routes/slots.js';
import bookingRoutes from './routes/bookings.js';
import walletRoutes from './routes/wallet.js';
import { errorHandler } from './middleware/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render terminates TLS in front of us
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
    })
  );
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/vehicles', vehicleRoutes);
  app.use('/api/stations', stationRoutes);
  app.use('/api/slots', slotRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }));

  // "/" sends signed-in browsers to the app and everyone else to login (login.js re-checks with /api/users/me)
  app.get('/', (req, res) => res.redirect(req.cookies?.access_token ? '/dashboard' : '/login'));
  app.use(express.static(publicDir, { extensions: ['html'] }));
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

  app.use(errorHandler);
  return app;
}
