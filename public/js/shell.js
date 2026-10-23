// Signed-in pages: loads the user (the server refreshes an expired access token itself), draws the sidebar.
import { api } from './api.js';
import { icons } from './icons.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home' },
  { href: '/stations', label: 'Find chargers', icon: 'pin' },
  { href: '/bookings', label: 'My bookings', icon: 'ticket' },
  { href: '/wallet', label: 'Wallet', icon: 'wallet' },
  { href: '/vehicle-setup', label: 'Add vehicle', icon: 'car' },
  { href: '/account', label: 'Account', icon: 'user' },
];

export const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);

// Resolves with the current user, or redirects to /login (handled inside api()).
export async function startPage(active) {
  const user = await api('/api/users/me');
  const nav = document.getElementById('nav');

  nav.innerHTML = `
    <div class="nav-top">
      <a class="brand" href="/dashboard">
        <span class="brand-mark">${icons.bolt}</span>EV.Bolts
      </a>
      <button class="nav-toggle btn sm" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-sheet">${icons.menu}</button>
    </div>
    <div class="nav-sheet" id="nav-sheet">
      <nav aria-label="Main">
        ${NAV.map(
          (n) => `<a class="nav-link${n.href === active ? ' active' : ''}" href="${n.href}"${n.href === active ? ' aria-current="page"' : ''}>${icons[n.icon]}${n.label}</a>`
        ).join('')}
      </nav>
      <div class="nav-user">
        <div class="who">
          <span class="avatar" aria-hidden="true">${esc(initials(user.name))}</span>
          <span class="who-text"><strong>${esc(user.name)}</strong><span class="muted">@${esc(user.username)}</span></span>
        </div>
        <button class="btn sm" type="button" id="logout">${icons.logout}Log out</button>
      </div>
    </div>`;

  const toggle = nav.querySelector('.nav-toggle');
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    toggle.innerHTML = open ? icons.close : icons.menu;
  });

  nav.querySelector('#logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.href = '/login'; }
  });

  return user;
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtDate = (d) => dateFmt.format(new Date(d));
