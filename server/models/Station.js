import mongoose from 'mongoose';

const stationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  // GeoJSON [lng, lat] so $geoNear can compute distances
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
});
stationSchema.index({ location: '2dsphere' });

export default mongoose.model('Station', stationSchema);
