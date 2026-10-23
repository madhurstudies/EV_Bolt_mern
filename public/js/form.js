// Small helpers shared by the forms.
export function clearErrors(form) {
  form.querySelectorAll('.err').forEach((e) => (e.textContent = ''));
  form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  const top = form.querySelector('.form-error');
  if (top) top.textContent = '';
}

// errors: { fieldName: 'message' }. Returns true if there were any.
export function showErrors(form, errors) {
  const entries = Object.entries(errors).filter(([, m]) => m);
  for (const [name, msg] of entries) {
    const slot = form.querySelector(`.err[data-for="${name}"]`);
    if (slot) slot.textContent = msg;
    form.querySelector(`[name="${name}"]`)?.setAttribute('aria-invalid', 'true');
  }
  if (entries.length) form.querySelector('[aria-invalid="true"]')?.focus();
  return entries.length > 0;
}

export function showFormError(form, message) {
  const slot = form.querySelector('.form-error');
  if (slot) slot.textContent = message;
}

export function wireReveal(form) {
  form.querySelectorAll('.reveal').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
    });
  });
}

export function busy(button, on, label) {
  if (on) button.dataset.label = button.textContent;
  button.disabled = on;
  button.textContent = on ? label : button.dataset.label;
}
