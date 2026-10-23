import dns from 'node:dns';
import mongoose from 'mongoose';

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
  // Some local resolvers refuse the SRV lookup mongodb+srv needs; allow overriding them.
  if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(',').map((x) => x.trim()));
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    dbName: process.env.DB_NAME || 'ev_bolts',
    serverSelectionTimeoutMS: 10000,
  });
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
