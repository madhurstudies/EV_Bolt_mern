import mongoose from 'mongoose';

// One wallet per user. Money is stored as integer paise so there is no floating-point drift.
const walletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balancePaise: { type: Number, default: 0, min: 0 }, // the database itself refuses a negative balance
  },
  { timestamps: true }
);

export default mongoose.model('Wallet', walletSchema);
