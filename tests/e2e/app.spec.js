import { test, expect } from '@playwright/test';

const PASSWORD = 'Passw0rd!x';
let n = 0;
const uname = (p = 'e2e') => `${p}${Date.now().toString(36)}${n++}`.slice(0, 20);

async function signup(page, username = uname(), name = 'Asha Kulkarni') {
  await page.goto('/signup');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return username;
}

async function addVehicle(page, plug = 'CCS2') {
  await page.goto('/vehicle-setup');
  await page.getByLabel('Make').fill('Tata');
  await page.getByLabel('Model', { exact: true }).fill('Nexon EV');
  await page.getByLabel('Model year').fill('2024');
  await page.getByLabel('Battery capacity').fill('40.5');
  await page.locator('.chip', { hasText: new RegExp(`^${plug}$`) }).click();
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('signed-out visitors are sent to login', async ({ page }) => {
  for (const path of ['/dashboard', '/stations', '/bookings', '/vehicle-setup']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('login rejects wrong credentials and validates empty fields', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter your username.')).toBeVisible();
  await page.getByLabel('Username').fill('nobody_here');
  await page.getByLabel('Password', { exact: true }).fill('Wrong123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid username or password' })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('signup validates the form and rejects a taken username', async ({ page }) => {
  const taken = await signup(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/signup');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Name is required.', { exact: true })).toBeVisible();
  await page.getByLabel('Full name').fill('Someone Else');
  await page.getByLabel('Username').fill(taken);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill('different1!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Username already taken')).toBeVisible();
});

async function topUp(page, amount) {
  await page.goto('/wallet');
  await page.locator('#amount').fill(String(amount));
  await page.getByRole('button', { name: 'Add money' }).click();
  await expect(page.getByText(`Added ₹${amount.toLocaleString('en-IN')}`)).toBeVisible();
}

// Earlier tests leave bays held or booked in the same database, so look for a station that has what we need.
async function stationWith(page, selector) {
  const names = await page.locator('.station-btn strong').allInnerTexts();
  for (const name of names) {
    await page.locator('.station-btn', { hasText: name }).click();
    if (await page.locator(selector).count()) return name;
  }
  throw new Error('no station has ' + selector);
}

// hold the first free matching bay at the nearest station, then confirm it (pays the advance)
async function holdAndConfirm(page) {
  await page.goto('/stations');
  await expect(page.locator('.station-btn').first()).toBeVisible();
  await stationWith(page, '[data-hold]:not([disabled])');
  await page.locator('[data-hold]').first().click();
  await expect(page.locator('.bay.mine')).toBeVisible();
  await page.getByRole('button', { name: /^Confirm/ }).click();
  await expect(page.getByText(/Booked and paid/)).toBeVisible();
  await expect(page.locator('.bay.mine')).toHaveCount(0);
}

test('full journey: signup, vehicle, wallet, hold, pay, charge, settle, refund, log out', async ({ page }) => {
  await signup(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Asha');
  await expect(page.getByText('No vehicles yet')).toBeVisible();

  await addVehicle(page, 'CCS2');
  await expect(page.getByText('Tata Nexon EV')).toBeVisible();
  await expect(page.locator('.kpi').filter({ has: page.getByText('Vehicles', { exact: true }) }).locator('.value')).toHaveText('1');

  await topUp(page, 2000);
  await expect(page.locator('#balance')).toHaveText('₹2,000.00');

  // hold a bay: the board shows power, rate and the advance before you commit
  await page.goto('/stations');
  await expect(page.locator('.station-btn').first()).toBeVisible();
  const heldAt = await stationWith(page, '[data-hold]:not([disabled])');
  await expect(page.locator('.bay.available .price').first()).toContainText('advance');
  await page.locator('[data-hold]').first().click();
  await expect(page.locator('.bay.mine')).toBeVisible();
  await expect(page.locator('[data-count]')).toHaveText(/^[0-5]:\d\d$/);
  // a second hold is blocked while one is active: look at another station's free bays
  await page.locator('.station-btn', { hasText: heldAt }).click();
  await expect(page.locator('.bay.mine')).toBeVisible();
  await stationWith(page, '[data-hold][disabled]');
  await page.locator('.station-btn', { hasText: heldAt }).click();

  // confirming pays the advance from the wallet
  await page.getByRole('button', { name: /^Confirm/ }).click();
  await expect(page.getByText(/Booked and paid/)).toBeVisible();
  await expect(page.locator('.bay.mine')).toHaveCount(0);
  await page.goto('/wallet');
  await expect(page.locator('#balance')).not.toHaveText('₹2,000.00');
  await expect(page.getByText('Advance paid')).toBeVisible();

  await page.goto('/dashboard');
  await expect(page.locator('.kpi').filter({ has: page.getByText('Active bookings', { exact: true }) }).locator('.value')).toHaveText('1');

  // start charging, then finish: bill settles on the metered energy and the unused advance comes back
  await page.goto('/bookings');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr .badge')).toHaveText('Booked');
  await page.getByRole('button', { name: 'Start charging' }).click();
  await expect(page.locator('tbody tr .badge')).toHaveText('Charging');
  await page.getByRole('button', { name: 'Finish charging' }).click();
  await expect(page.getByText(/Charging finished/)).toBeVisible();
  await expect(page.locator('#count')).toContainText('0 active · 1 completed');
  await expect(page.getByRole('tab', { name: 'Completed' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('refunded');

  await page.goto('/wallet');
  await expect(page.getByText('Refund: unused advance')).toBeVisible();

  // log out kills the session
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('cancelling a booking refunds the whole advance', async ({ page }) => {
  await signup(page);
  await addVehicle(page, 'CCS2');
  await topUp(page, 2000);
  await holdAndConfirm(page);

  await page.goto('/bookings');
  await page.getByRole('button', { name: 'Cancel booking' }).click(); // two steps: arm, then confirm
  await page.getByRole('button', { name: 'Confirm cancel?' }).click();
  await expect(page.getByText(/Booking cancelled/)).toBeVisible();
  await expect(page.getByText('No active bookings')).toBeVisible();
  await page.getByRole('tab', { name: 'Cancelled' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('refunded');

  await page.goto('/wallet');
  await expect(page.locator('#balance')).toHaveText('₹2,000.00');
});

test('confirming with too little money keeps the hold and points to the wallet', async ({ page }) => {
  await signup(page);
  await addVehicle(page, 'CCS2');
  await page.goto('/stations');
  await expect(page.locator('.station-btn').first()).toBeVisible();
  await stationWith(page, '[data-hold]:not([disabled])');
  await page.locator('[data-hold]').first().click();
  await expect(page.locator('.bay.mine')).toBeVisible();
  await page.getByRole('button', { name: /^Confirm/ }).click();
  await expect(page.getByText(/wallet balance is ₹0\.00/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add money' })).toBeVisible();
  await expect(page.locator('.bay.mine')).toBeVisible(); // still held

  await topUp(page, 2000);
  await page.goto('/stations');
  await expect(page.locator('.station-btn').first()).toBeVisible();
  await stationWith(page, '[data-confirm]');
  await page.getByRole('button', { name: /^Confirm/ }).click();
  await expect(page.getByText(/Booked and paid/)).toBeVisible();
});

test('wallet top-up validates the amount', async ({ page }) => {
  await signup(page);
  await page.goto('/wallet');
  await page.getByRole('button', { name: 'Add money' }).click();
  await expect(page.getByText('Enter a whole amount from ₹10 to ₹50,000.')).toBeVisible();
  await page.locator('#amount').fill('5');
  await page.getByRole('button', { name: 'Add money' }).click();
  await expect(page.getByText('Enter a whole amount from ₹10 to ₹50,000.')).toBeVisible();
  await expect(page.locator('#balance')).toHaveText('₹0.00');
});

test('edit a vehicle: the form is pre-filled and the change shows on the dashboard', async ({ page }) => {
  await signup(page);
  await addVehicle(page, 'CCS2');
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/vehicle-setup\?id=/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit vehicle');
  await expect(page.getByLabel('Make')).toHaveValue('Tata'); // pre-filled once loaded
  await expect(page.locator('.chip input:checked')).toHaveCount(1);

  await page.getByLabel('Model', { exact: true }).fill('Nexon Prime');
  await page.locator('.chip', { hasText: /^Type 2/ }).click(); // add a second connector
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Tata Nexon Prime')).toBeVisible();
  await expect(page.locator('.tag')).toHaveCount(2);
});

test('edit a vehicle: invalid values show field errors and nothing is saved', async ({ page }) => {
  await signup(page);
  await addVehicle(page, 'CCS2');
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Make')).toHaveValue('Tata');
  await page.getByLabel('Model year').fill('1999');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/Enter a year between/)).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByText(/2024 · 40.5 kWh/)).toBeVisible(); // unchanged
});

test('remove a vehicle (two-step confirm)', async ({ page }) => {
  await signup(page);
  await addVehicle(page, 'CCS2');
  await expect(page.getByText('Tata Nexon EV')).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Confirm remove?' }).click();
  await expect(page.getByText('No vehicles yet')).toBeVisible();
  await expect(page.locator('.kpi').filter({ has: page.getByText('Vehicles', { exact: true }) }).locator('.value')).toHaveText('0');
});

test('account: change name and email', async ({ page }) => {
  const username = await signup(page);
  await page.goto('/account');
  await expect(page.getByLabel('Full name')).toHaveValue('Asha Kulkarni');
  await expect(page.locator('#p-username')).toHaveValue(`@${username}`);
  await page.getByLabel('Full name').fill('Asha K-Rao');
  await page.getByLabel('Email').fill('asha@mail.in');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.locator('.who-text strong')).toHaveText('Asha K-Rao');
  await page.reload();
  await expect(page.getByLabel('Full name')).toHaveValue('Asha K-Rao');
  await expect(page.getByLabel('Email')).toHaveValue('asha@mail.in');

  await page.getByLabel('Email').fill('nope');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Please enter a valid email address.')).toBeVisible();
});

test('account: change password, then sign in with the new one', async ({ page }) => {
  const username = await signup(page);
  await page.goto('/account');
  await expect(page.getByLabel('Full name')).toHaveValue('Asha Kulkarni'); // page is ready

  await page.getByLabel('Current password', { exact: true }).fill('Wrong-pass1!');
  await page.getByLabel('New password', { exact: true }).fill('Brand-new1!');
  await page.getByLabel('Confirm new password', { exact: true }).fill('Brand-new1!');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Incorrect password.').first()).toBeVisible();
  await expect(page).toHaveURL(/\/account$/); // a wrong current password does not log you out

  await page.getByLabel('Current password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible();
  await page.goto('/dashboard'); // still signed in on this device
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid username or password')).toBeVisible(); // old password is dead

  await page.getByLabel('Password', { exact: true }).fill('Brand-new1!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('account: delete it for good (two-step), then the login no longer works', async ({ page }) => {
  const username = await signup(page);
  await page.goto('/account');
  await expect(page.getByLabel('Full name')).toHaveValue('Asha Kulkarni');

  await page.getByRole('button', { name: 'Delete my account' }).click(); // no password yet
  await expect(page.getByText('Enter your password to confirm.')).toBeVisible();

  await page.getByLabel('Your password', { exact: true }).fill('wrong-one');
  await page.getByRole('button', { name: 'Delete my account' }).click(); // arms
  await page.getByRole('button', { name: 'Click again to delete forever' }).click();
  await expect(page.getByText('Incorrect password.').first()).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);

  await page.getByLabel('Your password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('button', { name: 'Click again to delete forever' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid username or password')).toBeVisible();
});

test('account: wallet money must be given up knowingly before deleting', async ({ page }) => {
  await signup(page);
  await topUp(page, 500);
  await page.goto('/account');
  await expect(page.getByText(/wallet balance of ₹500\.00 will be lost/)).toBeVisible();
  await page.getByLabel('Your password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('button', { name: 'Click again to delete forever' }).click();
  await expect(page.getByText(/Confirm that you give up your wallet balance|still holds ₹500/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);

  await page.getByLabel(/wallet balance of/).check();
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('button', { name: 'Click again to delete forever' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('vehicle form shows field errors', async ({ page }) => {
  await signup(page);
  await page.goto('/vehicle-setup');
  await page.getByRole('button', { name: 'Save vehicle' }).click();
  await expect(page.getByText('Enter the make.')).toBeVisible();
  await expect(page.getByText('Select at least one valid connector.')).toBeVisible();
});

test('incompatible bays are marked and cannot be held', async ({ page }) => {
  await signup(page);
  await addVehicle(page, 'Tesla');
  await page.goto('/stations');
  await expect(page.locator('.station-btn').first()).toBeVisible();
  await stationWith(page, '.bay.nofit');
  await expect(page.locator('.bay.nofit').first()).toBeVisible();
  await expect(page.locator('.bay.nofit [data-hold]')).toHaveCount(0);
});

test('two browsers race for the same bay: only one wins', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await signup(a, uname('racea'));
  await signup(b, uname('raceb'));
  await a.goto('/stations');
  await b.goto('/stations');
  await expect(a.locator('.station-btn').first()).toBeVisible();
  await expect(b.locator('.station-btn').first()).toBeVisible();
  await stationWith(a, '[data-hold]:not([disabled])');
  await stationWith(b, '[data-hold]:not([disabled])');
  await expect(a.locator('[data-hold]').first()).toBeVisible();
  await expect(b.locator('[data-hold]').first()).toBeVisible();

  // both pages show the same bay as free; A takes it, B (still looking at a stale board) tries too
  await a.locator('[data-hold]').first().click();
  await expect(a.locator('.bay.mine')).toBeVisible();
  await b.locator('[data-hold]').first().click();
  await expect(b.getByText('Slot is no longer available')).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('menu folds away and no page scrolls sideways', async ({ page }) => {
    await page.goto('/login');
    await signup(page);
    await expect(page.getByRole('link', { name: 'My bookings' })).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('link', { name: 'My bookings' })).toBeVisible();
    await page.getByRole('link', { name: 'Find chargers' }).click();
    await expect(page).toHaveURL(/\/stations$/);

    // every signed-in page must fit the phone width
    await addVehicle(page, 'CCS2');
    for (const path of ['/dashboard', '/stations', '/bookings', '/wallet', '/account', '/vehicle-setup']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    }

    for (const path of ['/login', '/signup']) {
      await page.context().clearCookies();
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});
