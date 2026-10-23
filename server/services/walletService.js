// Wallet money movements. Every change is a single atomic update plus a ledger row.
import Wallet from '../models/Wallet.js';
import WalletTxn from '../models/WalletTxn.js';
import { HttpError } from '../middleware/error.js';

export const MIN_TOPUP = 10;
export const MAX_TOPUP = 50000;

export const toRupees = (paise) => Math.round(paise) / 100;
export const inr = (paise) => `₹${toRupees(paise).toFixed(2)}`;

export function ensureWallet(userId, session) {
  return Wallet.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId, balancePaise: 0 } }, { upsert: true, new: true, session });
}

function writeLedger(userId, type, amountPaise, balanceAfterPaise, { booking = null, note = '', session }) {
  return WalletTxn.create([{ user: userId, type, amountPaise, balanceAfterPaise, booking, note }], { session });
}

export async function credit(userId, amountPaise, type, opts = {}) {
  const wallet = await Wallet.findOneAndUpdate({ user: userId }, { $inc: { balancePaise: amountPaise } }, { new: true, session: opts.session });
  await writeLedger(userId, type, amountPaise, wallet.balancePaise, opts);
  return wallet;
}

// The balance check is part of the update filter, so two parallel debits can never overspend.
export async function debit(userId, amountPaise, type, opts = {}) {
  const wallet = await Wallet.findOneAndUpdate(
    { user: userId, balancePaise: { $gte: amountPaise } },
    { $inc: { balancePaise: -amountPaise } },
    { new: true, session: opts.session }
  );
  if (!wallet) {
    const current = await Wallet.findOne({ user: userId }).session(opts.session ?? null);
    throw new HttpError(402, `Your wallet balance is ${inr(current?.balancePaise ?? 0)} but this booking needs an advance of ${inr(amountPaise)}. Top up and confirm again.`);
  }
  await writeLedger(userId, type, amountPaise, wallet.balancePaise, opts);
  return wallet;
}

// Demo top-up: no real payment gateway. Whole rupees only.
export async function topup(userId, rupees) {
  if (!Number.isInteger(rupees) || rupees < MIN_TOPUP || rupees > MAX_TOPUP)
    throw new HttpError(400, `Enter a whole amount between ₹${MIN_TOPUP} and ₹${MAX_TOPUP}.`, { amount: `Enter ₹${MIN_TOPUP} to ₹${MAX_TOPUP}.` });
  await ensureWallet(userId);
  return credit(userId, rupees * 100, 'TOPUP', { note: 'Wallet top-up (demo)' });
}

export async function walletView(userId, limit = 50) {
  const wallet = await ensureWallet(userId);
  const txns = await WalletTxn.find({ user: userId }).sort({ createdAt: -1, _id: -1 }).limit(limit);
  return {
    balance: toRupees(wallet.balancePaise),
    transactions: txns.map((t) => ({
      id: t.id,
      type: t.type,
      amount: toRupees(t.amountPaise),
      balanceAfter: toRupees(t.balanceAfterPaise),
      note: t.note,
      createdAt: t.createdAt,
    })),
  };
}
