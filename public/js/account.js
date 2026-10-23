import { api, ApiError } from './api.js';
import { startPage, inr } from './shell.js';
import { clearErrors, showErrors, showFormError, wireReveal, busy } from './form.js';
import { validateName, validateEmail, validatePassword } from '/shared/validation.js';

const profileForm = document.getElementById('profile');
const passwordForm = document.getElementById('password');
const deleteForm = document.getElementById('delete');
[profileForm, passwordForm, deleteForm].forEach(wireReveal);

const submitOf = (form) => form.querySelector('button[type=submit]');
const note = (form, msg) => {
  const n = form.querySelector('.notice');
  if (!n) return;
  n.textContent = msg;
  n.hidden = !msg;
};
const failure = (form, err) => {
  if (err instanceof ApiError && err.errors) showErrors(form, err.errors);
  showFormError(form, err.message || 'Something went wrong. Try again.');
};

/* ---- Profile ---- */
profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(profileForm);
  note(profileForm, '');
  const body = { name: profileForm.elements.name.value.trim(), email: profileForm.elements.email.value.trim() };
  if (showErrors(profileForm, { name: validateName(body.name), email: validateEmail(body.email) })) return;

  busy(submitOf(profileForm), true, 'Saving…');
  try {
    const u = await api('/api/users/me', { method: 'PATCH', body });
    note(profileForm, 'Saved.');
    // keep the sidebar in step with the new name
    const who = document.querySelector('.who-text strong');
    if (who) who.textContent = u.name;
    const avatar = document.querySelector('.avatar');
    if (avatar) avatar.textContent = u.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  } catch (err) {
    failure(profileForm, err);
  }
  busy(submitOf(profileForm), false);
});

/* ---- Change password ---- */
passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(passwordForm);
  note(passwordForm, '');
  const f = passwordForm.elements;
  const body = { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value };
  const errors = {
    currentPassword: body.currentPassword ? '' : 'Enter your current password.',
    newPassword: validatePassword(body.newPassword),
    confirmPassword: body.newPassword === f.confirmPassword.value ? '' : 'Passwords do not match.',
  };
  if (showErrors(passwordForm, errors)) return;

  busy(submitOf(passwordForm), true, 'Changing…');
  try {
    await api('/api/users/me/password', { method: 'POST', body });
    passwordForm.reset();
    note(passwordForm, 'Password changed. Your other devices were signed out.');
  } catch (err) {
    failure(passwordForm, err);
  }
  busy(submitOf(passwordForm), false);
});

/* ---- Delete account: two steps (arm, then confirm) ---- */
let armedTimer = null;
function disarm() {
  clearTimeout(armedTimer);
  delete deleteForm.dataset.armed;
  submitOf(deleteForm).textContent = 'Delete my account';
}

deleteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(deleteForm);
  const password = deleteForm.elements.password.value;
  if (showErrors(deleteForm, { password: password ? '' : 'Enter your password to confirm.' })) return;

  if (!deleteForm.dataset.armed) {
    deleteForm.dataset.armed = '1';
    submitOf(deleteForm).textContent = 'Click again to delete forever';
    armedTimer = setTimeout(disarm, 5000);
    return;
  }

  busy(submitOf(deleteForm), true, 'Deleting…');
  try {
    await api('/api/users/me', { method: 'DELETE', body: { password, confirmForfeit: deleteForm.elements.confirmForfeit.checked } });
    location.href = '/login';
  } catch (err) {
    failure(deleteForm, err);
    busy(submitOf(deleteForm), false);
    disarm();
  }
});

/* ---- Fill the page once we know who the user is ---- */
const user = await startPage('/account');
document.getElementById('p-username').value = `@${user.username}`;
profileForm.elements.name.value = user.name;
profileForm.elements.email.value = user.email || '';

try {
  const wallet = await api('/api/wallet');
  if (wallet.balance > 0) {
    document.getElementById('forfeit-field').hidden = false;
    document.getElementById('forfeit-text').textContent = `I understand my wallet balance of ${inr(wallet.balance)} will be lost.`;
  }
} catch { /* the server asks for confirmation anyway */ }

for (const form of [profileForm, passwordForm, deleteForm]) submitOf(form).disabled = false;
