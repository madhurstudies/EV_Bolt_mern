// fetch wrapper: JSON in/out. Cookies are sent automatically. The server refreshes an expired
// access token by itself (using the refresh token in the database), so a 401 here means "log in again".
export class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors || {};
  }
}

// redirectOn401: false is used by the login pages, which just want to know "am I signed in?"
export async function api(path, { method = 'GET', body, redirectOn401 = true } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && !path.startsWith('/api/auth/') && redirectOn401) {
    location.replace('/login');
    return new Promise(() => {}); // page is navigating away
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.message || `Request failed (${res.status})`, data?.errors);
  return data;
}
