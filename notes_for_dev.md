# Notes for developers

Use these notes to explain the project: what it does, how it is built, why each choice was made, and what a reviewer is likely to ask.

For the story of how it was built (decisions, problems and fixes, testing, deployment), see [build_log.md](build_log.md).

EV.Bolts lets a driver register their electric vehicle, find charging stations in Pune sorted by distance, **hold** a matching charging bay for 5 minutes, **confirm** it into a booking, and cancel it later. Confirming pays an **advance from a demo wallet**; a charging session is **settled on the energy actually used** and the unused advance is refunded.

This is a rebuild of an earlier Java version (Spring Boot + MySQL + React). The stack is now **Node.js + Express + MongoDB (Atlas) + plain HTML/CSS/JavaScript**.

## 1. The 60-second explanation

1. The browser loads static pages (`public/*.html`) and calls a JSON API (`/api/...`) on the **same server**, so there is no CORS and no separate frontend build.
2. Login gives the browser a short-lived **access token** (5 min) in an **httpOnly cookie** (scripts can't read it). The long-lived **refresh token** (30 days) stays **in the database** and never leaves the server. When the access token expires, the server quietly uses the refresh token to issue a new one.
3. Stations, bays, vehicles and bookings live in **MongoDB**. Distance sorting is done by MongoDB itself (`$geoNear`).
4. The interesting part is booking: when two people press "Hold" on the same bay at the same instant, **exactly one wins**. The database decides, using one atomic conditional update (section 5).

## 2. Stack and why

| Piece | Choice | Why |
|---|---|---|
| Runtime | Node.js 20+ (ES modules) | Required by the brief; one language front and back. |
| Web framework | Express 5 | Small and familiar. Async errors reach the error handler without wrappers. |
| Database | MongoDB Atlas + Mongoose | Required by the brief; Atlas free tier means nothing to install. Mongoose gives schemas and validation. |
| Passwords | `bcryptjs` | Pure JS, so no native compile on Windows. Hashing is salted and slow on purpose. |
| Sessions | `jsonwebtoken`; access token in an httpOnly cookie, refresh token in MongoDB | Fast access checks; the refresh token lives in the database so logout and a newer login really revoke it. |
| Security headers | `helmet` | Sensible defaults plus a Content-Security-Policy (no inline scripts). |
| Frontend | HTML + CSS + ES modules, no framework | Simple to explain; nothing to bundle. |
| Tests | `node:test` + `supertest`, Playwright | API tests against real MongoDB; browser tests drive real Chrome. |
| Hosting | Render (web service) + Atlas | Both free tiers. |

## 3. Folder map

```
server/
  app.js              builds the Express app (exported so tests can use it)
  server.js           connects to MongoDB, starts the 10s expiry job, listens
  config/db.js        mongoose connection (reads MONGODB_URI, DB_NAME)
  models/             User, Vehicle, Station, Slot, Booking
  routes/             auth, users, vehicles, stations, slots, bookings, health
  services/slotService.js     holding a bay (atomic hold / release / expiry sweep)
  services/bookingService.js  confirm + pay, start, finish + settle, cancel + refund, no-show sweep
  services/walletService.js  wallet debit / credit / top-up and the ledger
  middleware/         auth.js (requireAuth), error.js (HttpError + handler)
  utils/tokens.js     create/verify JWTs, set/clear cookies
  jobs/releaseExpiredHolds.js   every 10 s: free expired holds, refund no-show bookings
  scripts/            db-check.js, seed.js, seedData.js (the 8 Pune stations)
shared/validation.js  validation rules used by BOTH the server and the browser
public/               pages (*.html), css/, js/, img/station-bg.jpg
tests/api/            API integration tests (real MongoDB)
tests/e2e/            Playwright browser tests
```

`shared/validation.js` is the one file imported by both sides. A rule like "username is 3-20 chars and starts with a letter" is written once, so the form and the API can't disagree.

## 4. Data model

| Collection | Key fields | Notes |
|---|---|---|
| `users` | name, username (unique, case-insensitive), email?, passwordHash, refreshToken | `refreshToken` is the login session's 30-day refresh token (a signed JWT). Each new login replaces it; logout sets it to `null`. |
| `vehicles` | owner, make, model, year, batteryCapacityKwh, maxChargingPowerKw?, connectorTypes[] | Connector types are an **array inside the vehicle**. |
| `stations` | name, address, location (GeoJSON Point) | `2dsphere` index, which powers distance queries. |
| `slots` | station, slotNumber, connectorType, type (`FAST`/`SLOW`), powerKw, ratePerKwh, status, lockedBy, lockExpiresAt | status is `AVAILABLE`, `SOFT_LOCKED` (held), `BOOKED` or `IN_PROGRESS` (charging). Shown to users as "bays". Bays created before billing get a default price on startup. |
| `bookings` | user, slot, station, connectorType, chargerType, powerKw, status, startBy, startedAt, completedAt, cancelledAt, **bill{}** | status is `BOOKED`, `IN_PROGRESS`, `COMPLETED` or `CANCELLED`. History is kept. The **bill is embedded** (1:1 with the booking): rate, advance, energy, final amount, refund, payment status. |
| `wallets` | user (unique), balancePaise | One per user. Money is **integer paise**, so there is no floating-point drift. |
| `wallettxns` | user, type (`TOPUP`/`ADVANCE_DEBIT`/`REFUND`), amountPaise, balanceAfterPaise, booking?, note | Append-only ledger: one row per money movement. |

**Why slots are their own collection (not embedded in stations):** each bay changes state independently and concurrently. Updating one small document atomically is exactly what we need. Embedding would mean rewriting a whole station document for every hold.

**Why connector types are embedded in vehicles:** they are always read together with the vehicle and are tiny. MySQL needed a join table; MongoDB doesn't.

## 5. The booking flow and concurrency (the part to be ready to explain)

States of a slot: `AVAILABLE → SOFT_LOCKED (5 min) → BOOKED`, and back to `AVAILABLE` on release, expiry or cancel.

**Hold.** One database call:

```js
Slot.findOneAndUpdate(
  { _id, $or: [ {status:'AVAILABLE'}, {status:'SOFT_LOCKED', lockExpiresAt:{$lt: now}} ] },
  { $set: { status:'SOFT_LOCKED', lockedBy: me, lockExpiresAt: now + 5min } },
  { new: true })
```

The *check* and the *change* happen in one atomic step inside MongoDB. If 20 requests arrive together, MongoDB applies them one after another; the first matches, the other 19 no longer match and get `null`, which we turn into **409 "Slot is no longer available"**. A test proves it: 20 users, exactly 1 success, 19 conflicts.

**Confirm.** A conditional update (`SOFT_LOCKED`, held by *me*, not expired) to `BOOKED`, plus creating the booking, inside one **transaction**, so we never get a booked slot without a booking record. (Transactions need a replica set, which Atlas always is.)

**Release / cancel.** Only the holder / owner can do it. Cancelling a booking marks it `CANCELLED` and frees the slot, in one transaction.

**Expiry** is handled twice, on purpose:
- *Lazy:* an expired hold counts as free in the hold filter and in the station list, so it is correct immediately.
- *Sweep:* a job runs every 10 s and resets expired holds to `AVAILABLE` (this replaces the old `@Scheduled` task).

**Known gap:** "one live hold per user" is checked with a read before the atomic update, so two parallel requests from the *same* user could in theory both pass. It can't double-book a bay, only let one user hold two. Fixing it would need a unique partial index; noted as a trade-off for simplicity.

## 5a. Wallet, billing and charging sessions

**Wallet.** Every account has a wallet. Top-up is a **demo** (no payment gateway): whole rupees from 10 to 50,000. Debits and credits are single atomic updates plus a ledger row. The balance check is **inside the update filter** (`balancePaise: { $gte: amount }`), so two parallel payments can never overspend, and the schema forbids a negative balance as a second guard.

**Pricing.** Each bay has a speed (fast or slow), a power in kW and a rate in rupees per kWh. The **advance** is power x a 30-minute session x rate (for example a 60 kW fast bay at ₹18/kWh asks for ₹540). The board shows it before you hold.

**Lifecycle.** `confirm` -> `start` -> `finish`, or `cancel`:
- **Confirm** runs in one transaction: bay becomes BOOKED, the advance is debited, the booking and its bill are created, the ledger row is written. If the balance is too low it fails with **402** and the whole transaction rolls back, so the bay simply stays held and the user can top up and retry.
- **Start** moves the booking to IN_PROGRESS and the bay to "in use".
- **Finish** settles the bill: final cost = metered energy x the rate **copied at booking time**, never more than the advance. The rest is refunded to the wallet. A later price change never touches an existing bill.
- **Cancel** (only before starting) refunds the full advance and frees the bay.
- **No-show:** a booking not started within 30 minutes is cancelled and refunded automatically by the same 10-second job that expires holds.

Because the paid session is the cap, a user never owes extra, so the ledger needs only top-up, advance and refund (the old SQL design also had a "final debit").

**Simulated meter.** There is no real charger, so `finish` uses a stand-in meter that reports 40-100% of the paid session. In production the charger would report the energy. Tests replace the meter with a fixed value.

## 6. Authentication, step by step

1. **Two tokens, two homes.** The **access token** (5 minutes) travels in an httpOnly cookie. The **refresh token** (30 days) is stored **only in the database**, in the `refreshToken` field of the user, and is never sent to the browser. The access token carries a session id (`sid`) that matches the stored refresh token's id, which ties it to one login.
2. **Signup:** validate, create the account (bcrypt-hashed password), save a new refresh token on the user, set the access cookie, create the wallet. The page then goes to the dashboard.
3. **Login:** find the user, check the password against the bcrypt hash (the same 401 for a wrong password and an unknown user), then do the same as signup: save a **new** refresh token on the user and set a new access cookie. The page then goes to the dashboard.
4. **Every API request** goes through `requireAuth` (`server/middleware/auth.js`):
   - **Access token valid:** carry on. The user comes from the token, never from the request body or query.
   - **Access token expired:** the server checks the refresh token stored in the database. If it exists, is still valid (30 days, correct signature) and belongs to the same session (`jti === sid`), the server issues a new access cookie and **the request carries on and answers 200**. The browser never sees a 401 and doesn't retry anything.
   - **Otherwise** (no stored refresh token, it expired, or a newer login replaced it): 401 and the browser goes to the login page.
5. **Logout:** clears the access cookie and sets `refreshToken` to `null` in the database. It works even if the access token has already expired. It only ends the session that cookie belongs to, so logging out on an old device can't kill a newer login.
6. **One device at a time:** a new login replaces the stored refresh token, so the older device is signed out as soon as its current access token runs out (at most 5 minutes).
7. **Why the cookie lasts 30 days when the token inside lasts 5 minutes:** if the browser deleted the cookie after 5 minutes, the server would never receive it and could never refresh. The 5 minutes is the token's own expiry, checked by the server.
8. **Cookie settings:** `httpOnly` (scripts can't read it), `sameSite=lax`, and `secure` in production.

## 6a. Account and vehicle management (CRUD)

Create, Read, Update and Delete for each thing a driver owns:

| Resource | Create | Read | Update | Delete |
|---|---|---|---|---|
| Account | sign up | `GET /api/users/me` | `PATCH /api/users/me` (name, email), `POST /api/users/me/password` | `DELETE /api/users/me` |
| Vehicles | `POST /api/vehicles` | `GET /api/vehicles`, `GET /api/vehicles/:id` | `PATCH /api/vehicles/:id` | `DELETE /api/vehicles/:id` |
| Bookings | confirm a held bay | `GET /api/bookings` | start, finish, cancel (state changes) | cancel is the delete; bills are kept as records |
| Wallet | created at signup, top-up | `GET /api/wallet` | top-up | none: the ledger is append-only on purpose |

- **Vehicles** are owner-only. Someone else's vehicle, or a malformed id, gives **404** (never 403), so ids can't be probed. An edit merges the stored values with your changes and runs the **same validation as adding** a vehicle.
- **Edit profile:** name and email only. The username is the login identity, so it can't change.
- **Change password:** asks for the current password (a wrong one is a 400 field error, not a 401, because the browser treats 401 as "log in again"), checks the new one against the password rules, saves the new hash and **starts a new session**. This device stays signed in; every other device is signed out.
- **Delete account** is a **hard delete**: the user, vehicles, wallet, wallet history and bookings are removed in one transaction, and the cookie is cleared. It needs the password and is refused (409) while you hold a bay or have a booked or charging session, and it makes you confirm giving up any wallet money.
- **Stations and bays** are not editable from the website: they come from the seed (`server/scripts/seedData.js`, run with `npm run seed -- --reset`).

## 7. How the old Java stack maps to this one

| Java / MySQL version | Node / MongoDB version |
|---|---|
| Table | Collection |
| `vehicle_connectors` join table | `connectorTypes` array inside `vehicles` |
| JPA entity + bean validation | Mongoose schema + `shared/validation.js` |
| `@RestController` / `@Service` | Express route / `services/` function |
| Spring Security filter (`JwtFilter`) | `requireAuth` middleware |
| `BCryptPasswordEncoder` | `bcryptjs` |
| `jjwt` | `jsonwebtoken` |
| `@Transactional` | `session.withTransaction(...)` |
| `@Scheduled(fixedRate=10000)` | `setInterval` in `jobs/` |
| Haversine in `GeoDistanceUtil` | MongoDB `$geoNear` on a `2dsphere` index |
| `UNIQUE(active_slot_id)` / `@Version` guarding double booking | One atomic conditional `findOneAndUpdate` |
| `wallets`, `wallet_transactions` tables, `CHECK (balance >= 0)` | `wallets` + `wallettxns` collections; balance guard inside the update filter |
| `bills` table (1:1 with a booking) | `bill` object embedded in the booking |
| `application.properties` | `.env` (`MONGODB_URI`, JWT secrets) |
| React + Vite + proxy | Static HTML/JS served by Express (same origin) |

## 7a. Problems in the old version that this rebuild fixes

- Slot endpoints took `?userId=` from the URL, so anyone could act as anyone. Now the user comes from the verified token.
- The dashboard called `lockSlot` / `confirmBooking` / `releaseLock`, which didn't exist in the API client, and used a `user.id` that `/me` never returned, so booking never worked end to end.
- Locking was "read, then save", so two users could both lock a slot. It is now a single atomic update.
- There was no booking record. Confirming only flipped a slot to BOOKED. Now there is a bookings collection with history and cancel.
- `schema.sql` didn't match the entities. Now the Mongoose models are the single source of truth.

## 8. Design

- Dark theme with one accent green (`#00e676`). Colour is used for data (available bays, held bays, booked), not decoration.
- Layout rules came from the "taste-skill" app-screen guidance: open-plane sidebar, KPIs as type, flat surfaces, one typeface (DM Sans), no gradients/glows/emoji.
- **The only photograph is the blurred login/signup background** (a lightly blurred CC BY 4.0 photo; credit shown in a small info button, bottom-left). Everything else is icons (inline SVG) and type.
- The signature element is the **slot board**: each bay shows its plug, live state, a countdown when it's yours, and is greyed out if it doesn't fit your vehicle's connector.

## 9. Testing

- `npm test`: 53 API tests against a real MongoDB database called `ev_bolts_test` (wiped before and after; the helper refuses to run against `ev_bolts`). Covers auth (refresh token only in the database, transparent refresh of an expired access token, expired refresh token, one device at a time, logout with an expired token, forged tokens), validation, ownership, sorting, the 20-user race, expiry, confirm, cancel, wallet and billing (insufficient funds, parallel top-ups, double-confirm charges once, settlement and refund, no-show refund), vehicle edit and delete, profile and password changes, and deleting an account.
- `npm run test:e2e`: 18 Playwright tests in real Chrome against a throwaway `ev_bolts_e2e` database: signup, add vehicle, hold, confirm, booking list, cancel, logout, a two-browser race, wrong login, form errors, and phone layout (including "no sideways scroll").
- `BASE_URL=https://<your-app> npm run test:e2e` runs the same browser tests against the deployed site.

## 10. Likely questions

**Why MongoDB and not MySQL here?** The brief asked for it. Technically, bays are small independently-updated documents and atomic single-document updates fit that well; vehicles' connector lists embed naturally.

**How do you stop two people booking the same bay?** One atomic conditional update (section 5). Not "check then update". Demonstrated by the 20-user test.

**Why httpOnly cookies and not localStorage?** JavaScript (and so any injected script) can't read them, which limits the damage of an XSS bug. `sameSite=lax` plus a JSON-only API reduces CSRF risk.

**Why two tokens?** The access token is short-lived (5 minutes), so a leaked one stops working quickly. The refresh token is long-lived (30 days) but never leaves the server, and it is checked against the database, so logout and a newer login really revoke it.

**Why is the refresh token in the database and not in a cookie?** Then the browser can never leak or replay it: the only thing the browser holds is a 5-minute access token. The server decides, on each expired request, whether the session is still allowed to continue.

**What exactly happens when the access token expires?** The server sees the expiry, loads the user, verifies the stored refresh token (valid, not expired, same session), issues a new access cookie and lets the same request finish with a normal 200. The browser needs no special code for it.

**What if someone logs in on a second device?** The stored refresh token is replaced, so the first device can no longer refresh. It stops working once its current 5-minute access token runs out.

**What happens if a user holds a bay and closes the tab?** After 5 minutes the hold expires. It shows as available at once (lazy check) and the sweep job resets it.

**Why polling every 5 s and not WebSockets?** Simpler to build and explain, and fine at this scale. WebSockets or Server-Sent Events would be the next step.

**Why one Express app serves the pages too?** Same origin, so cookies just work, no CORS config, one deployment.

**How do you stop the wallet going negative or being double-spent?** The balance check is part of the same atomic update that subtracts the money, so parallel requests are serialised by MongoDB. Confirming also runs in a transaction, so a failed payment rolls the bay back to "held". A test confirms the same hold twice in parallel and checks the user is charged once.

**Why store money as integer paise?** Floating-point numbers can't represent values like 0.1 exactly; whole paise add up exactly.

**Why is the rate copied onto the booking?** So a later price change never rewrites what a customer already agreed to pay.

**Why does the bill sit inside the booking instead of its own collection?** It is always read and written together with the booking (1:1), so one document and one atomic update is simpler.

## 11. Known limitations (be upfront about these)

- No rate limiting on login (add `express-rate-limit` before real use).
- The wallet is a demo: top-up takes no real payment (no gateway). The charger meter is simulated.
- There are no admin screens: stations, bays and prices come from the seed file.
- Deleting an account is permanent and removes its bookings too, so no record of that user remains.
- Stations are seeded sample data for Pune, not a real feed.
- A user can briefly end up with two holds if they send two requests at the very same instant (section 5).
- A copied access token keeps working until it expires (up to 5 minutes), even after logout, because access tokens are checked without a database lookup. After that, nothing can refresh it.
- Only one device can be signed in at a time (one refresh token per user).
- The 30 days are counted from login; there is no sliding renewal, so a user must sign in again every 30 days.
- Users who were signed in before this auth change had to sign in again once.
- Render's free tier sleeps when idle, so the first request after a quiet period takes about a minute.
- MongoDB Atlas is open to all IPs (`0.0.0.0/0`) for the demo, protected by the database user's password. Restrict it for production.
- Local standalone `mongod` doesn't support transactions; use Atlas or a replica set.

## 12. Credits

Login background: "Car2Go Charging Station Stuttgart 2013 01" by Julian Herzog, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0), via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Car2Go_Charging_Station_Stuttgart_2013_01.jpg). It is blurred and darkened in the page; the credit sits in a small info button at the bottom-left, which expands on hover.
