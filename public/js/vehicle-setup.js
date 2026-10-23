import { api, ApiError } from './api.js';
import { startPage, esc } from './shell.js';
import { clearErrors, showErrors, showFormError, busy } from './form.js';
import { CONNECTORS, validateVehicle } from '/shared/validation.js';

// /vehicle-setup adds a vehicle; /vehicle-setup?id=<id> edits that one.
const editId = new URLSearchParams(location.search).get('id');

const form = document.getElementById('form');
const submit = form.querySelector('button[type=submit]');

document.getElementById('chips').innerHTML = Object.entries(CONNECTORS)
  .map(([key, label]) => `<label class="chip"><input type="checkbox" name="connector" value="${key}"><span>${esc(label)}</span></label>`)
  .join('');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  const f = form.elements;
  const body = {
    make: f.make.value.trim(),
    model: f.model.value.trim(),
    year: f.year.value,
    batteryCapacityKwh: f.batteryCapacityKwh.value,
    maxChargingPowerKw: f.maxChargingPowerKw.value,
    connectorTypes: [...form.querySelectorAll('input[name=connector]:checked')].map((c) => c.value),
  };

  if (showErrors(form, validateVehicle(body))) return;

  busy(submit, true, 'Saving…');
  try {
    if (editId) await api(`/api/vehicles/${editId}`, { method: 'PATCH', body });
    else await api('/api/vehicles', { method: 'POST', body });
    location.href = '/dashboard';
  } catch (err) {
    if (err instanceof ApiError && err.errors) showErrors(form, err.errors);
    showFormError(form, err.message || 'Could not save the vehicle.');
    busy(submit, false);
  }
});

// Edit mode: change the wording and pre-fill the form. Saving stays disabled until the vehicle has loaded.
async function loadForEdit() {
  document.title = 'Edit vehicle · EV.Bolts';
  document.querySelector('h1').textContent = 'Edit vehicle';
  document.querySelector('.page-head p').textContent = 'Change its details. Saving updates the bays we show you.';
  submit.textContent = 'Save changes';
  submit.disabled = true;
  try {
    const v = await api(`/api/vehicles/${editId}`);
    const f = form.elements;
    f.make.value = v.make;
    f.model.value = v.model;
    f.year.value = v.year;
    f.batteryCapacityKwh.value = v.batteryCapacityKwh;
    f.maxChargingPowerKw.value = v.maxChargingPowerKw ?? '';
    for (const c of form.querySelectorAll('input[name=connector]')) c.checked = v.connectorTypes.includes(c.value);
    submit.disabled = false;
  } catch (err) {
    showFormError(form, err.status === 404 ? 'That vehicle was not found. It may have been removed.' : err.message);
  }
}

// Last, so the form works the moment the page loads (this waits on the session check).
if (editId) loadForEdit();
await startPage('/vehicle-setup');
