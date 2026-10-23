import { api } from './api.js';
import { startPage, esc, fmtDate, inr } from './shell.js';
import { CONNECTORS } from '/shared/validation.js';

const $ = (id) => document.getElementById(id);
await startPage('/bookings');

let bookings = [];
let tab = 'ACTIVE';

const TABS = {
  ACTIVE: (b) => b.status === 'BOOKED' || b.status === 'IN_PROGRESS',
  COMPLETED: (b) => b.status === 'COMPLETED',
  CANCELLED: (b) => b.status === 'CANCELLED',
};
const BADGE = {
  BOOKED: ['ok', 'Booked'],
  IN_PROGRESS: ['hold', 'Charging'],
  COMPLETED: ['off', 'Completed'],
  CANCELLED: ['off', 'Cancelled'],
};

function notice(kind, msg) {
  const n = $('notice');
  n.hidden = !msg;
  n.className = `notice ${kind}`;
  n.textContent = msg;
}

function money(b) {
  const x = b.bill;
  if (b.status === 'COMPLETED') return `<strong>${inr(x.amount)}</strong> for ${x.energyKwh} kWh<br><span class="muted">${inr(x.refund)} refunded of ${inr(x.advance)} advance</span>`;
  if (b.status === 'CANCELLED') return `<strong>${inr(x.refund ?? 0)}</strong> refunded<br><span class="muted">full advance returned</span>`;
  return `<strong>${inr(x.advance)}</strong> advance paid<br><span class="muted">${x.ratePerKwh != null ? `${inr(x.ratePerKwh)}/kWh` : ''}</span>`;
}

function when(b) {
  if (b.status === 'BOOKED') return b.startBy ? `Start by ${fmtDate(b.startBy)}<br><span class="muted">booked ${fmtDate(b.createdAt)}</span>` : fmtDate(b.createdAt);
  if (b.status === 'IN_PROGRESS') return `Started ${fmtDate(b.startedAt)}`;
  if (b.status === 'COMPLETED') return fmtDate(b.completedAt);
  return fmtDate(b.cancelledAt);
}

function actions(b) {
  if (b.status === 'BOOKED')
    return `<div class="row-actions"><button class="btn primary sm" type="button" data-start="${b.id}">Start charging</button><button class="btn sm danger" type="button" data-cancel="${b.id}">Cancel booking</button></div>`;
  if (b.status === 'IN_PROGRESS') return `<div class="row-actions"><button class="btn primary sm" type="button" data-finish="${b.id}">Finish charging</button></div>`;
  return '';
}

function render() {
  const counts = Object.fromEntries(Object.entries(TABS).map(([k, f]) => [k, bookings.filter(f).length]));
  $('count').textContent = `${counts.ACTIVE} active · ${counts.COMPLETED} completed · ${counts.CANCELLED} cancelled`;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));

  const shown = bookings.filter(TABS[tab]);
  if (!shown.length) {
    const msg = { ACTIVE: 'No active bookings', COMPLETED: 'No completed sessions yet', CANCELLED: 'Nothing cancelled' }[tab];
    $('list').innerHTML = `<div class="empty"><div><strong>${msg}</strong>${
      tab === 'ACTIVE' ? '<br>Hold a bay at a station and confirm it to see it here.' : ''
    }</div>${tab === 'ACTIVE' ? '<a class="btn primary" href="/stations">Find a charger</a>' : ''}</div>`;
    return;
  }

  $('list').innerHTML = `<table>
    <thead><tr><th>Station</th><th>Bay</th><th>Payment</th><th>${tab === 'ACTIVE' ? 'Timing' : 'When'}</th><th>Status</th><th class="num"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${shown
      .map((b) => {
        const [cls, label] = BADGE[b.status];
        const speed = b.powerKw ? ` · ${b.chargerType === 'FAST' ? 'Fast' : 'Slow'} ${b.powerKw} kW` : '';
        return `<tr>
          <td><strong>${esc(b.stationName)}</strong><br><span class="muted">${esc(b.stationAddress)}</span></td>
          <td>${esc(b.slotNumber)}<br><span class="muted">${esc(CONNECTORS[b.connectorType] || b.connectorType)}${speed}</span></td>
          <td>${money(b)}</td>
          <td>${when(b)}</td>
          <td><span class="badge ${cls}">${label}</span></td>
          <td class="num">${actions(b)}</td>
        </tr>`;
      })
      .join('')}</tbody></table>`;
}

async function load() {
  try {
    bookings = await api('/api/bookings');
    render();
  } catch (err) {
    notice('err', err.message || 'Could not load bookings.');
    $('list').innerHTML = '';
  }
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  tab = t.dataset.tab;
  render();
});

async function run(path, okMsg, nextTab) {
  try {
    const b = await api(path, { method: 'POST' });
    notice('ok', typeof okMsg === 'function' ? okMsg(b) : okMsg);
  } catch (err) {
    notice('err', err.message);
  }
  if (nextTab) tab = nextTab;
  await load();
}

// cancel is two-step: first click arms the button, second click does it
$('list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.start) {
    btn.disabled = true;
    return run(`/api/bookings/${btn.dataset.start}/start`, 'Charging started. The bay is yours until you finish.');
  }
  if (btn.dataset.finish) {
    btn.disabled = true;
    return run(
      `/api/bookings/${btn.dataset.finish}/finish`,
      (b) => `Charging finished: ${b.bill.energyKwh} kWh used (${inr(b.bill.amount)}). ${inr(b.bill.refund)} of your advance was refunded to your wallet.`,
      'COMPLETED'
    );
  }
  if (btn.dataset.cancel) {
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Confirm cancel?';
      setTimeout(() => {
        if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Cancel booking'; }
      }, 4000);
      return;
    }
    btn.disabled = true;
    return run(`/api/bookings/${btn.dataset.cancel}/cancel`, (b) => `Booking cancelled. ${inr(b.bill.refund)} was refunded to your wallet.`);
  }
});

await load();
