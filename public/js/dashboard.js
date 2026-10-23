import { api } from './api.js';
import { startPage, esc, fmtDate, inr } from './shell.js';
import { CONNECTORS } from '/shared/validation.js';

const $ = (id) => document.getElementById(id);
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const user = await startPage('/dashboard');
$('title').textContent = `${greeting()}, ${user.name.split(' ')[0]}.`;

try {
  const [vehicles, bookings, wallet, stations] = await Promise.all([
    api('/api/vehicles'),
    api('/api/bookings'),
    api('/api/wallet'),
    api('/api/stations/nearby?lat=18.5204&lng=73.8567'), // central Pune
  ]);
  const active = bookings.filter((b) => b.status === 'BOOKED' || b.status === 'IN_PROGRESS');

  $('subtitle').textContent = vehicles.length
    ? 'Here is your garage and what is booked.'
    : 'Add a vehicle to start charging.';

  const totalKwh = vehicles.reduce((n, v) => n + v.batteryCapacityKwh, 0);
  const kpi = (label, value, unit, note) =>
    `<div class="kpi"><div class="label">${label}</div><div class="value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div><div class="note">${note}</div></div>`;
  $('kpis').innerHTML =
    kpi('Vehicles', vehicles.length, '', 'Registered to your account') +
    kpi('Total battery', +totalKwh.toFixed(1), 'kWh', 'Across all vehicles') +
    kpi('Wallet balance', inr(wallet.balance), '', wallet.balance > 0 ? 'Pays your next advance' : 'Add money to book a bay') +
    kpi('Active bookings', active.length, '', active.length ? 'Slots you have confirmed' : 'Nothing booked right now');

  $('vehicles').innerHTML = vehicles.length
    ? `<div class="rows">${vehicles
        .map(
          (v) => `<div class="row-item"><div class="row-main">
            <strong>${esc(v.make)} ${esc(v.model)}</strong>
            <span class="muted">${v.year} · ${v.batteryCapacityKwh} kWh battery${v.maxChargingPowerKw ? ` · ${v.maxChargingPowerKw} kW max` : ''}</span>
            <div class="tags">${v.connectorTypes.map((c) => `<span class="tag">${esc(CONNECTORS[c] || c)}</span>`).join('')}</div>
          </div><div class="row-actions"><a class="btn sm" href="/vehicle-setup?id=${v.id}">Edit</a><button class="btn sm danger" type="button" data-remove="${v.id}">Remove</button></div></div>`
        )
        .join('')}</div>`
    : `<div class="empty"><div><strong>No vehicles yet</strong><br>Register one so we can match you with the right plugs.</div><a class="btn primary" href="/vehicle-setup">Add your first vehicle</a></div>`;

  const myPlugs = new Set(vehicles.flatMap((v) => v.connectorTypes));
  $('nearby').innerHTML = `<div class="rows">${stations
    .slice(0, 3)
    .map((s) => {
      const free = s.slots.filter((x) => x.status === 'AVAILABLE' && (!myPlugs.size || myPlugs.has(x.connectorType))).length;
      return `<div class="row-item"><div class="row-main">
        <strong>${esc(s.name)}</strong>
        <span class="muted">${esc(s.address)} · ${s.distanceKm} km from central Pune</span>
      </div><span class="badge ${free ? 'ok' : 'off'}">${free} free${myPlugs.size ? ' for you' : ''}</span></div>`;
    })
    .join('')}</div>`;

  $('bookings').innerHTML = active.length
    ? `<div class="rows">${active
        .slice(0, 5)
        .map(
          (b) => `<div class="row-item"><div class="row-main">
            <strong>${esc(b.stationName)}</strong>
            <span class="muted">Slot ${esc(b.slotNumber)} · ${esc(CONNECTORS[b.connectorType] || b.connectorType)} · ${fmtDate(b.createdAt)}</span>
          </div><span class="badge ${b.status === 'IN_PROGRESS' ? 'hold' : 'ok'}">${b.status === 'IN_PROGRESS' ? 'Charging' : 'Booked'}</span></div>`
        )
        .join('')}</div>`
    : `<div class="empty"><div><strong>No active bookings</strong><br>Hold a slot at a nearby station and confirm it.</div><a class="btn" href="/stations">Find a charger</a></div>`;
} catch (err) {
  $('error').hidden = false;
  $('error').textContent = err.message || 'Could not load your data.';
  $('subtitle').textContent = '';
}

// Remove a vehicle: two steps (first click arms the button, second click deletes it)
$('vehicles').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'Confirm remove?';
    setTimeout(() => {
      if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Remove'; }
    }, 4000);
    return;
  }
  btn.disabled = true;
  try {
    await api(`/api/vehicles/${btn.dataset.remove}`, { method: 'DELETE' });
    location.reload();
  } catch (err) {
    $('error').hidden = false;
    $('error').textContent = err.message || 'Could not remove the vehicle.';
    btn.disabled = false;
  }
});
