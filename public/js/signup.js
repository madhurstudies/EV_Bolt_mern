import { api, ApiError } from './api.js';
import { clearErrors, showErrors, showFormError, wireReveal, busy } from './form.js';
import { validateName, validateUsername, validateEmail, validatePassword } from '/shared/validation.js';

const form = document.getElementById('form');
const submit = form.querySelector('button[type=submit]');
wireReveal(form);

api('/api/users/me', { redirectOn401: false })
  .then(() => location.replace('/dashboard'))
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  const body = {
    name: form.elements.name.value.trim(),
    username: form.elements.username.value.trim(),
    email: form.elements.email.value.trim(),
    password: form.elements.password.value,
  };

  // same rules the server enforces (shared/validation.js)
  const errors = {
    name: validateName(body.name),
    username: validateUsername(body.username),
    email: validateEmail(body.email),
    password: validatePassword(body.password),
    confirmPassword: body.password === form.elements.confirmPassword.value ? '' : 'Passwords do not match.',
  };
  if (showErrors(form, errors)) return;

  busy(submit, true, 'Creating account…');
  try {
    await api('/api/auth/signup', { method: 'POST', body });
    location.href = '/dashboard';
  } catch (err) {
    if (err instanceof ApiError && err.errors) showErrors(form, err.errors);
    showFormError(form, err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
    busy(submit, false);
  }
});
