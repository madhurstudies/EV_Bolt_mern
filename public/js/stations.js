import { api, ApiError } from './api.js';
import { startPage, esc, inr } from './shell.js';
import { CONNECTORS } from '/shared/validation.js';

const $ = (id) => document.getElementById(id);
await startPage('/stations');

const PUNE = { lat: 18.5204, lng: 73.8567 };
const POLL_MS = 5000;

let origin = PUNE;
let stations = [];
let vehicles = [];
let selectedId = null;
let signature = '';
const expiresAt = new Map(); // slotId -> ms timestamp, for the countdown

function notice(kind, html) {
  const n = $('notice');
  n.hidden = !html;
  n.className = `notice ${kind}`;
  n.innerHTML = html;
}

const currentVehicle = () => vehicles.find((v) => v.id === $('vehicle').value) || null;
const fits = (slot) => {
  const v = currentVehicle();
  return !v || v.connectorTypes.includes(slot.connectorType);
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; // taste-skill-ignore (a clock)
const myHold = () => stations.flatMap((s) => s.slots).find((s) => s.heldByMe);

async function loadWallet() {
  try {
    const w = await api('/api/wallet');
    $('wallet').textContent = `Wallet ${inr(w.balance)}`;
  } catch { /* the board still works without it */ }
}

async function load({ quiet = false } = {}) {
  try {
    stations = await api(`/api/stations/nearby?lat=${origin.lat}&lng=${origin.lng}`);
    const now = Date.now();
    for (const slot of stations.flatMap((s) => s.slots)) {
      if (slot.heldByMe) expiresAt.set(slot.id, now + slot.holdSecondsLeft * 1000);
      else expiresAt.delete(slot.id);
    }
    if (!stations.some((s) => s.id === selectedId)) selectedId = stations[0]?.id ?? null;
    render();
  } catch (err) {
    if (!quiet) notice('err', esc(err.message || 'Could not load stations.'));
  }
}

function render(force = false) {
  // Skip the redraw when nothing changed, so buttons keep focus while polling.
  const sig = JSON.stringify([selectedId, $('vehicle').value, stations.map((s) => [s.id, s.distanceKm, s.slots.map((x) => [x.id, x.status, x.heldByMe, x.ratePerKwh, x.powerKw])])]);
  if (sig === signature && !force) return;
  signature = sig;

  $('stations').innerHTML = stations.length
    ? stations
        .map((s) => {
          const free = s.slots.filter((x) => x.status === 'AVAILABLE' && fits(x)).length;
          return `<button class="station-btn" type="button" data-station="${s.id}" aria-pressed="${s.id === selectedId}">
            <strong>${esc(s.name)}</strong>
            <span class="muted">${esc(s.address)}</span>
            <span class="station-meta"><span>${s.distanceKm} km away</span><span class="${free ? 'free' : 'muted'}">${free} free for you</span></span>
          </button>`;
        })
        .join('')
    : '<div class="empty">No stations found.</div>';

  const st = stations.find((s) => s.id === selectedId);
  if (!st) { $('board').innerHTML = '<div class="empty">Select a station to see its bays.</div>'; return; }

  const held = myHold();
  $('board').innerHTML = `
    <div class="board-head">
      <h2>${esc(st.name)}</h2>
      <p>${esc(st.address)} · ${st.slots.length} bays · each booking pays a 30-minute advance, unused energy is refunded</p>
    </div>
    <div class="bays">${st.slots.map((s) => bay(s, held)).join('')}</div>`;
  tick();
}

function bay(s, held) {
  const plug = esc(CONNECTORS[s.connectorType] || s.connectorType);
  const speed = s.powerKw ? ` · ${s.chargerType === 'FAST' ? 'Fast' : 'Slow'} ${s.powerKw} kW` : '';
  const price = s.ratePerKwh != null ? `<div class="price">${inr(s.ratePerKwh)}/kWh · advance ${inr(s.advance)}</div>` : '';
  const head = `<div class="no">Bay ${esc(s.slotNumber)}</div><div class="plug">${plug}${speed}</div>${price}`;

  if (s.heldByMe)
    return `<div class="bay mine">${head}<div class="state">Held for you · <span data-count="${s.id}">${mmss(s.holdSecondsLeft)}</span></div>
      <div class="actions"><button class="btn primary sm" type="button" data-confirm="${s.id}">Confirm · ${inr(s.advance)}</button><button class="btn sm" type="button" data-release="${s.id}">Release</button></div></div>`;
  if (s.bookedByMe) return `<div class="bay taken">${head}<div class="state">${s.status === 'IN_PROGRESS' ? 'Your session' : 'Your booking'}</div></div>`;
  if (s.status === 'IN_PROGRESS') return `<div class="bay taken">${head}<div class="state">In use</div></div>`;
  if (s.status === 'BOOKED') return `<div class="bay taken">${head}<div class="state">Booked</div></div>`;
  if (s.status === 'SOFT_LOCKED') return `<div class="bay taken">${head}<div class="state">Someone is booking</div></div>`;
  if (!fits(s)) return `<div class="bay nofit">${head}<div class="state">Doesn’t fit your plug</div></div>`;
  return `<div class="bay available">${head}<div class="state">Available</div>
    <div class="actions"><button class="btn sm" type="button" data-hold="${s.id}"${held ? ' disabled title="You already hold another bay"' : ''}>Hold 5 min</button></div></div>`;
}

// 1s countdown on the held bay; when it hits zero, refresh from the server
function tick() {
  for (const el of document.querySelectorAll('[data-count]')) {
    const left = Math.max(0, Math.ceil((expiresAt.get(el.dataset.count) - Date.now()) / 1000));
    el.textContent = mmss(left);
    if (left === 0) { notice('err', 'Your hold expired. The bay is free again.'); expiresAt.delete(el.dataset.count); load(); }
  }
}
setInterval(tick, 1000);
setInterval(() => { if (!document.hidden) load({ quiet: true }); }, POLL_MS);

async function act(path, okMsg) {
  notice('', '');
  try {
    await api(path, { method: 'POST' });
    if (okMsg) notice('ok', okMsg);
  } catch (err) {
    const msg = esc(err instanceof ApiError ? err.message : 'Something went wrong.');
    // not enough money: the hold is kept, so point them to the wallet
    notice('err', err instanceof ApiError && err.status === 402 ? `${msg} <a href="/wallet">Add money</a>` : msg);
  }
  await Promise.all([load(), loadWallet()]);
  render(true);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.station) { selectedId = t.dataset.station; render(true); }
  else if (t.dataset.hold) act(`/api/slots/${t.dataset.hold}/hold`, 'Bay held for 5 minutes. Confirm it before the timer runs out.');
  else if (t.dataset.confirm) act(`/api/slots/${t.dataset.confirm}/confirm`, 'Booked and paid! Start charging from <a href="/bookings">My bookings</a> within 30 minutes.');
  else if (t.dataset.release) act(`/api/slots/${t.dataset.release}/release`, 'Hold released.');
});

$('vehicle').addEventListener('change', () => render(true));

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return notice('err', 'Your browser does not support location.');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $('origin').textContent = 'Distances from your location.';
      load();
    },
    () => notice('err', 'Could not get your location. Showing distances from central Pune.'),
    { timeout: 8000 }
  );
});

try {
  vehicles = await api('/api/vehicles');
} catch { vehicles = []; }
$('vehicle').innerHTML =
  '<option value="">any vehicle (all plugs)</option>' +
  vehicles.map((v) => `<option value="${v.id}">${esc(v.make)} ${esc(v.model)} · ${v.connectorTypes.map((c) => esc(CONNECTORS[c] || c)).join(', ')}</option>`).join('');
if (vehicles.length) $('vehicle').value = vehicles[0].id;
else notice('ok', 'Tip: <a href="/vehicle-setup">add your vehicle</a> and we will show only the bays that fit its plug.');

loadWallet();
await load();
