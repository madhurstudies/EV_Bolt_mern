import { api, ApiError } from './api.js';
import { clearErrors, showErrors, showFormError, wireReveal, busy } from './form.js';

const form = document.getElementById('form');
const submit = form.querySelector('button[type=submit]');
wireReveal(form);

// Already signed in (the server refreshes an expired access token itself)? Skip straight to the app.
api('/api/users/me', { redirectOn401: false })
  .then(() => location.replace('/dashboard'))
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  const body = { username: form.elements.username.value.trim(), password: form.elements.password.value };

  const missing = {};
  if (!body.username) missing.username = 'Enter your username.';
  if (!body.password) missing.password = 'Enter your password.';
  if (showErrors(form, missing)) return;

  busy(submit, true, 'Signing in…');
  try {
    await api('/api/auth/login', { method: 'POST', body });
    location.href = '/dashboard';
  } catch (err) {
    showFormError(form, err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
    busy(submit, false);
  }
});
