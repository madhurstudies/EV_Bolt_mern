// Verifies the MongoDB connection string works: connect, write, read, clean up.
import { connectDb, disconnectDb } from '../config/db.js';

try {
  const conn = await connectDb();
  console.log(`Connected to database "${conn.name}" on ${conn.host}`);
  const col = conn.collection('_healthcheck');
  const { insertedId } = await col.insertOne({ at: new Date() });
  const found = await col.findOne({ _id: insertedId });
  await col.deleteOne({ _id: insertedId });
  console.log(found ? 'Write + read OK.' : 'Write succeeded but read failed.');
  await disconnectDb();
  process.exit(found ? 0 : 1);
} catch (err) {
  console.error('MongoDB check FAILED:', err.message);
  process.exit(1);
}
