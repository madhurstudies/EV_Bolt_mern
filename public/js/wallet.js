import { api, ApiError } from './api.js';
import { startPage, esc, fmtDate, inr } from './shell.js';
import { clearErrors, showErrors, showFormError, busy } from './form.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const submit = form.querySelector('button[type=submit]');
const QUICK = [200, 500, 1000, 2000];

$('quick').innerHTML = QUICK.map((n) => `<button class="chip-btn" type="button" data-amt="${n}">${inr(n).replace('.00', '')}</button>`).join('');
$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-amt]');
  if (b) { form.elements.amount.value = b.dataset.amt; form.elements.amount.focus(); }
});

const LABEL = { TOPUP: 'Top-up', ADVANCE_DEBIT: 'Advance paid', REFUND: 'Refund' };

function render(w) {
  $('balance').textContent = inr(w.balance);
  $('history').innerHTML = w.transactions.length
    ? `<table>
        <thead><tr><th>When</th><th>What</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead>
        <tbody>${w.transactions
          .map((t) => {
            const debit = t.type === 'ADVANCE_DEBIT';
            return `<tr>
              <td>${fmtDate(t.createdAt)}</td>
              <td><strong>${LABEL[t.type] ?? esc(t.type)}</strong>${t.note ? `<br><span class="muted">${esc(t.note)}</span>` : ''}</td>
              <td class="num ${debit ? '' : 'plus'}">${debit ? '−' : '+'}${inr(t.amount)}</td>
              <td class="num">${inr(t.balanceAfter)}</td>
            </tr>`;
          })
          .join('')}</tbody></table>`
    : '<div class="empty"><div><strong>No transactions yet</strong><br>Add money to pay for your first booking.</div></div>';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  $('notice').hidden = true;
  const amount = Number(form.elements.amount.value);
  if (showErrors(form, { amount: Number.isInteger(amount) && amount >= 10 && amount <= 50000 ? '' : 'Enter a whole amount from ₹10 to ₹50,000.' })) return;

  busy(submit, true, 'Adding…');
  try {
    await api('/api/wallet/topup', { method: 'POST', body: { amount } });
    form.reset();
    render(await api('/api/wallet'));
    $('notice').className = 'notice ok';
    $('notice').textContent = `Added ${inr(amount)} to your wallet.`;
    $('notice').hidden = false;
  } catch (err) {
    if (err instanceof ApiError && err.errors) showErrors(form, err.errors);
    showFormError(form, err.message || 'Could not add money.');
  }
  busy(submit, false);
});

await startPage('/wallet');
try {
  render(await api('/api/wallet'));
} catch (err) {
  $('history').innerHTML = `<div class="notice err">${esc(err.message)}</div>`;
}
