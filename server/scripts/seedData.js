// Pune stations + bays. Imported by the seed script and by tests.
import Station from '../models/Station.js';
import Slot from '../models/Slot.js';
import { BAY_DEFAULTS } from '../services/bayDefaults.js';

export const STATIONS = [
  { name: 'Koregaon Park Fast Hub', address: 'North Main Rd, Koregaon Park, Pune', lat: 18.5362, lng: 73.8939, slots: ['CCS2', 'CCS2', 'CCS2', 'TYPE_2', 'BHARAT_DC_001', 'CHADEMO'] },
  { name: 'Baner Highstreet Charge', address: 'Baner Rd, Baner, Pune', lat: 18.559, lng: 73.7868, slots: ['CCS2', 'CCS2', 'TYPE_2', 'BHARAT_AC_001'] },
  { name: 'Hinjewadi Phase 2 Plaza', address: 'Rajiv Gandhi Infotech Park, Hinjewadi, Pune', lat: 18.5912, lng: 73.7389, slots: ['CCS2', 'CCS2', 'CCS2', 'CCS2', 'TYPE_2', 'TYPE_2', 'BHARAT_DC_001', 'TESLA'] },
  { name: 'Viman Nagar Mall Chargers', address: 'Nagar Rd, Viman Nagar, Pune', lat: 18.5679, lng: 73.9143, slots: ['CCS2', 'TYPE_2', 'BHARAT_AC_001', 'BHARAT_AC_001'] },
  { name: 'Shivajinagar Metro Station', address: 'FC Rd, Shivajinagar, Pune', lat: 18.5308, lng: 73.8475, slots: ['TYPE_2', 'TYPE_2', 'BHARAT_AC_001', 'CCS2'] },
  { name: 'Kothrud Depot Point', address: 'Paud Rd, Kothrud, Pune', lat: 18.5074, lng: 73.8077, slots: ['CCS2', 'TYPE_2', 'CHADEMO', 'GB_T'] },
  { name: 'Magarpatta City Hub', address: 'Magarpatta Rd, Hadapsar, Pune', lat: 18.5167, lng: 73.9272, slots: ['CCS2', 'CCS2', 'TYPE_2', 'BHARAT_DC_001', 'TYPE_1'] },
  { name: 'Wakad Bypass Station', address: 'Mumbai-Bangalore Hwy, Wakad, Pune', lat: 18.5993, lng: 73.7603, slots: ['CCS2', 'CCS2', 'TYPE_2', 'TYPE_2', 'TESLA'] },
];

export async function seedStations() {
  for (const s of STATIONS) {
    const station = await Station.create({
      name: s.name,
      address: s.address,
      location: { type: 'Point', coordinates: [s.lng, s.lat] },
    });
    await Slot.insertMany(
      s.slots.map((connectorType, i) => ({ station: station._id, slotNumber: `S${i + 1}`, connectorType, ...BAY_DEFAULTS[connectorType] }))
    );
  }
}
