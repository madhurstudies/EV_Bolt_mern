import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, trim: true },
    email: { type: String, trim: true, default: '' },
    passwordHash: { type: String, required: true },
    // The login session's refresh token (30-day JWT). Kept only here, never sent to the browser.
    // null after logout; replaced by each new login (one device at a time).
    refreshToken: { type: String, default: null },
  },
  { timestamps: true }
);

// Usernames are unique ignoring case (alex_j == Alex_J)
const CI = { locale: 'en', strength: 2 };
userSchema.index({ username: 1 }, { unique: true, collation: CI });

export const ci = CI;
export default mongoose.model('User', userSchema);
