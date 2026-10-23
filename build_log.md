# Build log: how EV.Bolts was rebuilt

This is the story of the build: what we started from, what we decided, the order we worked in, every problem we hit and how it was fixed, and how to repeat any step.

For *how the finished app works* (architecture, booking logic, auth, likely questions), read [notes_for_dev.md](notes_for_dev.md). This file is about *how we got here*.

## 1. Where we started

A finished-looking project in `template project/`: **Spring Boot + MySQL + React (Vite)**. The goal: rebuild the same product on **Node.js + MongoDB + plain HTML/CSS/JavaScript**, with a better UI, and ship it in one night.

We read every file before planning. What the old app actually did:

- Sign up, login, logout and token refresh, using JWTs in an httpOnly cookie and BCrypt (`AuthService`, `JwtService`, `CookieUtil`).
- `GET /api/users/me`, and add/list vehicles with a connector-type enum.
- A station finder: Pune stations sorted by distance (Haversine), each with slots; a 5-minute "soft lock" on a slot, then confirm or release; a scheduled job freeing expired locks every 10 seconds.
- UI: login, signup, dashboard, vehicle setup. Dark theme, green accent `#00e676`, brand name "EV.Bolts".

What it **claimed but never delivered**, which we deliberately did not copy:

| Problem in the old app | Why it mattered |
|---|---|
| Slot endpoints read `?userId=` from the URL | Anyone could act as any user. |
| The dashboard called `evApi.lockSlot` / `confirmBooking` / `releaseLock`, which didn't exist, and used a `user.id` that `/me` never returned | The booking flow never worked end to end. |
| Locking was "read slot, then save" | Two users could both lock the same slot. |
| Confirming only flipped a slot's status | There was no booking record, history or cancel. |
| `schema.sql` didn't match the entities | The database design file and the code disagreed. |
| `schema.sql` also described a wallet, bills and admin revenue views that were never built | The wallet and billing became the "rest of the build" later. The admin part was later dropped (section 8b). |

## 2. Decisions we made (and who made them)

Questions put to the project owner, and their answers:

| Question | Answer |
|---|---|
| How much of the template should we cover? | "Parity + My Bookings": everything the old app really did, fixed, plus a bookings list with cancel. |
| What does "ship" mean? | Deploy live: Render (web) + MongoDB Atlas (database). |
| Where does MongoDB run? | Atlas free tier. |
| Later: "build the rest" | Wallet + top-up, billing (advance and settle), and an admin dashboard. The admin dashboard was built, then cancelled by the owner and removed. |

Other decisions, made by us:

- **One Express app serves the pages and the API.** Same origin, so cookies just work, there is no CORS and no build step.
- **bcryptjs, not bcrypt.** It needs no native compile on Windows.
- **Money as integer paise** to avoid floating-point errors.
- **No UI framework.** Plain ES modules; one shared `validation.js` imported by both the server and the browser.
- **Only one photograph in the whole app:** the blurred login/signup background. Everything else is type and inline SVG icons (as requested).

## 3. The order of work

Times are from the git history (22-23 Oct).

| # | Phase | What happened | Commit |
|---|---|---|---|
| 1 | **Plan** | Read the template, asked scope questions, wrote the plan (stack, data model, API, UI rules, build order, test plan). | none |
| 2 | **Scaffold** | `package.json`, Express app, Mongoose connection, health route, models, 8-station Pune seed, shared validation. | - |
| 3 | **Pause: connect MongoDB** | Work stopped until the Atlas connection string was supplied. Hit a DNS problem (see section 4). | - |
| 4 | **Backend** | Auth, vehicles, stations (`$geoNear`), atomic hold/confirm/release, bookings, expiry job, 24 API tests. | - |
| 5 | **Frontend** | All pages, the live slot board, Playwright browser tests. | - |
| 6 | **Design pass** | Lint + inspector + screenshots at 3 widths; brand styles fixed, "Closest chargers" panel added, phone overflow bug fixed. | - |
| 7 | **Docs** | `README.md` and `notes_for_dev.md`. | - |
| 8 | **Deploy** | Pushed to GitHub; created the Render service; fixed the Atlas network error (section 4). Verified live with the browser suite; found and fixed a real form bug. | - |
| 9 | **Auth-page polish** | Background blur reduced from 24px to 7px; photo credit moved into a hover button. | - |
| 10 | **Wallet and billing** | Wallet ledger, advance billing and settlement, no-show refunds, then the wallet screens and tests. | - |
| 11 | **Live check** | Browser suite against the deployed site; timeout raised for slow networks. | - |
| 12 | **Auth model change** | Refresh token moved into the database, access token cut to 5 minutes, refresh made transparent on the server (section 8a). | - |
| 13 | **CRUD completion** | Edit/remove vehicles; edit profile, change password, delete account (section 8b). | - |
| 14 | **Admin removed** | The admin area (revenue, stations, bays, maintenance) was cancelled by the owner and removed everywhere. | - |
| 15 | **History reorganised** | The commit history was rebuilt into branches by area (section 9). | - |

Everything was developed on a `rebuild/node-mongo` branch, then fast-forwarded into `main`; later changes went straight to `main`.

## 4. Problems we hit, and what fixed them

Listed in the order they happened. These are the useful part: each one is a trap you can avoid.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | A large shell command that wrote many files failed with "unexpected EOF"; nothing ran | Quote clash inside a heredoc in the shell | Write files with the file-writing tool, not shell heredocs. |
| 2 | `npm run db:check` failed: `querySrv ECONNREFUSED` | Node was asking a local resolver (`127.0.0.1`) that refuses SRV lookups, which `mongodb+srv://` needs. The system resolver and Google DNS both worked. | Optional `DNS_SERVERS=8.8.8.8,1.1.1.1` in `.env`, applied in `server/config/db.js`. Not set in production. |
| 3 | A "fix" command hung | A malformed shell construct | Stopped the task, redid the edit with the file tool. |
| 4 | An API test failed: "refresh after access cookie is gone" | The test's way of dropping a cookie didn't actually drop it | Rewrote it to use a genuinely expired JWT. |
| 5 | Signup form read the wrong value for `name` | `form.name` in the browser returns the *form's* name attribute, not the input called "name" | Use `form.elements.name`. |
| 6 | Browser tests: "strict mode violation" on the password field | "Show or hide password" button's label also contains "password" | `getByLabel('Password', { exact: true })`. |
| 7 | Sidebar logo looked unstyled | The brand CSS lived only in the auth stylesheet | Moved to the shared base stylesheet. |
| 8 | Dashboard felt empty on large screens | Content ended halfway down the screen | Added a "Closest chargers" panel. |
| 9 | **Phones: the whole page scrolled sideways (1884px wide)** | The horizontally scrolling station row stretched a CSS grid track | Grid tracks use `minmax(0, 1fr)`. Added an overflow test for every page. |
| 10 | Render logs: `SSL alert number 80` / `tlsv1 alert internal error` | **Atlas rejects connections from IPs not on its allow-list.** It worked locally only because Atlas had auto-added the developer's IP. | Atlas -> Network Access -> allow `0.0.0.0/0`, then redeploy. Render was also using Node 26; if the error ever persists, pin `NODE_VERSION=22`. |
| 11 | **Live site only:** vehicle form showed no errors, just reloaded | The page script waited for the session check *before* attaching the form's submit handler. On a slow connection a quick click submitted the form the plain browser way. | Attach handlers first, then call the session check. This race only showed up against the real deployed site. |
| 12 | Background photo was too dark to recognise as a charging station | Heavy blur plus a dark overlay | Blur 24px -> 7px, overlay lightened. |
| 13 | Several browser tests failed after more tests were added | Tests assumed the nearest station always has a free bay, but earlier tests change that | A `stationWith(...)` helper clicks through stations until one has what the test needs. |
| 14 | A mangled regular expression in a generated test | Shell escaping of backslashes | Fixed in code, then `node --check` on the file. |
| 15 | Long live-site test timed out once | Many network round trips; passes in 20s alone | Longer default timeout when `BASE_URL` is set. |

A pattern worth remembering: **three of the worst bugs (9, 11, 14) were found by looking at real screenshots or by testing the deployed site**, not by reading code.

## 5. How the design skill was used

We used the locally installed **taste-skill** (`design-taste-frontend`) from the local plugins folder. Its scripts were run directly.

1. **App-screen rules**, because nearly everything here is an app screen (dashboard, lists, forms), not a landing page.
2. `draw.mjs --app --kind smb-admin --keep palette`: dealt a style ("Accent ladder": full brand colour only on small marks, pale tints for areas), the **DM Sans** typeface and an **open-plane shell** (sidebar on the page, no top bar). The dealt sheet was light; we kept our **dark brand palette** and applied the dealt *composition*.
3. `assets.mjs` searched open image collections for a charging-station photo. We chose one licensed **CC BY 4.0** (no share-alike rule), credited in the page.
4. **`lint.mjs --app`** (banned patterns) is clean. **`inspect.mjs --app`** was run on the public pages (it can't sign in, so signed-in pages were checked from our own screenshots at 1440, 768 and 390 pixels).
5. Rules we kept to: no gradients, glows, glass panels, emoji, tiny uppercase labels or "01/02" numbering; KPIs as plain type in one container; colour only on data (available, held, booked); every page has loading, empty and error states.

## 6. Testing: what exists and how to run it

| Suite | Count | Run | What it uses |
|---|---|---|---|
| API integration | 53 | `npm test` | Real MongoDB, database `ev_bolts_test` (wiped before and after; the helper **refuses** to run on `ev_bolts`). |
| Browser (Playwright, real Chrome) | 18 | `npm run test:e2e` | Starts the real app on port 3100 against `ev_bolts_e2e`, wiped and re-seeded each run. |
| Against the live site | same | `BASE_URL=https://ev-bolt-mern.onrender.com npm run test:e2e` | The same suite, against the deployed app (it creates throwaway accounts). |

The tests worth knowing about:

- **20 users race for one bay**: exactly 1 wins, 19 get a conflict.
- **Two browsers race** for the same bay.
- Confirming the **same hold twice in parallel** charges the user once.
- **10 parallel top-ups** all land and add up exactly.
- **CRUD:** vehicle edit and delete are owner-only (404 for anyone else); a password change signs other devices out but keeps this one; deleting an account removes everything and is refused while a booking is active.
- **Auth:** an expired access token with a valid refresh token in the database still returns 200 and a new cookie; an expired refresh token or a newer login returns 401; logout works with an expired token.
- Expired holds, no-show refunds, and price changes never rewriting an existing bill.
- No page may scroll sideways at phone width.

Every test touches a throwaway database, never the real one.

## 7. Deployment, step by step

1. **MongoDB Atlas:** free M0 cluster; a database user; Network Access `0.0.0.0/0`; copy the `mongodb+srv://` string.
2. **Local `.env`** (never committed; `*.env` is git-ignored): `MONGODB_URI`, `DB_NAME=ev_bolts`, two JWT secrets, optional `DNS_SERVERS`.
3. `npm run db:check`, then `npm run seed` (8 stations, 40 bays).
4. **GitHub:** `madhurstudies/EV_Bolt_mern`, branch `main`.
5. **Render:** New Web Service from the repo; build `npm ci`; start `npm start`; environment variables `NODE_ENV=production`, `DB_NAME`, `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Render redeploys on every push.
6. Check `/api/health` returns `{"ok":true,"db":"connected"}`.
7. Live URL: **https://ev-bolt-mern.onrender.com** (the free tier sleeps when idle; the first request after a quiet period takes about a minute).

On startup the server also gives any bay without a price a default speed and price, so old data keeps working after the billing release.

## 8. Security notes from the build

- Secrets live only in `.env` (ignored). Before publishing we searched every tracked file for the database password and username: none found.
- The **Atlas password was pasted into chat** during setup, so it should be rotated in Atlas and updated in `.env` and in Render. An `atlas-credentials.env` file also sits in the project folder (ignored by git, but delete it once it is no longer needed).
- Atlas is open to all IPs for the demo; restrict it for real use.
- Sessions: a 5-minute access token in an httpOnly cookie (`sameSite=lax`, `secure` in production); the 30-day refresh token lives only in the database and is revocable; passwords are hashed; the user is always taken from the verified token, never from the request.
- Not done (documented as limits): login rate limiting, per-user rule for "one hold at a time" can be briefly bypassed by two simultaneous requests.

## 8a. Auth model change (refresh token in the database)

**Why:** the owner wanted the original Java app's model: the refresh token belongs in the database, not in a cookie.

| | Before | After |
|---|---|---|
| Access token | 15 min, cookie | **5 min**, cookie |
| Refresh token | 15 days, **cookie** (its id was in the database) | **30 days, only in the database** (`user.refreshToken`) |
| Expired access token | Browser got a 401, called `/api/auth/refresh`, retried | Server refreshes by itself and the request answers **200** |
| `POST /api/auth/refresh` | existed | removed |
| Second device login | both devices stayed signed in | the older device is signed out (one device at a time, chosen by the owner) |

**How it works:** see "Authentication, step by step" in [notes_for_dev.md](notes_for_dev.md).

**Two details worth remembering:**
- The access **cookie** lives 30 days even though the **token** inside expires in 5 minutes. If the cookie expired with the token, the browser would delete it and the server could never refresh. (The original Java app had that flaw: its cookie lived as long as its token.)
- Each access token carries the id of the refresh token it was issued with (`sid`). A refresh only happens when it matches the stored one, which is what makes a newer login end an older session.

**Adding the database field:** MongoDB has no fixed table layout, so adding `refreshToken` to the Mongoose `User` model was the entire "migration". Existing users get the field on their next login; users signed in before the change had to log in once.

**Tests:** the auth tests were rewritten (53 API tests in total, 18 browser tests). They craft genuinely expired tokens to prove: a valid stored refresh token turns an expired access token into a 200 with a new cookie; an expired or replaced one gives a 401; logout works with an expired token; forged tokens are rejected.

## 8b. CRUD completion, and removing the admin area

**CRUD audit.** We listed every route and found Create and Read almost everywhere, but Update and Delete missing for vehicles and the account. The owner chose to build: vehicles (edit, delete) and account (edit profile, change password, delete account), with **hard delete**. The full table of what exists is in "Account and vehicle management (CRUD)" in [notes_for_dev.md](notes_for_dev.md).

**Design choices worth remembering:**
- A wrong current password on a password change returns **400 with a field error**, not 401, because the browser treats any 401 as "go to the login page".
- Changing the password starts a new session: this device stays in, every other device is signed out.
- Deleting an account is refused while a bay is held or a booking is active (it would leave a bay stuck), and asks the user to confirm giving up any wallet money.
- Hard delete also removes the user's bookings, which is acceptable now that there is no revenue reporting.

**Admin removed.** An admin area (revenue by day/week/month, add stations and bays, edit prices, maintenance mode, a `make-admin` command) had been built and tested. The owner then decided it would not be part of the project, and it was removed from the code, tests and docs: the routes, pages, the `role` and `maintenance` fields, the validators and the tests. Stations, bays and prices now come from the seed only.

## 9. Branches and commit history

On request, the history was rebuilt so that the work is grouped by area, each area on its own branch, and all of them merged at the end:

| Branch | What it holds |
|---|---|
| `parth` | Sessions and JWT: token utilities, the auth middleware with the transparent refresh, signup/login/logout, account endpoints, and their API tests |
| `Malhar` | The front end: HTML, CSS and the browser JavaScript, the design tokens and the login background |
| `Pranay` | The database: the MongoDB connection and check script, all the Mongoose models, the seed and the bay price defaults |
| `main` | Everything else (project setup, the Express app and routes, services, shared validation, tests, docs), finished by one **merge commit** that brings in `parth`, `Malhar` and `Pranay` |

Notes:
- Every file belongs to exactly one branch, so the merge has no conflicts, and the merged result is identical to the finished project.
- The original, step-by-step commit history was replaced. Each new commit contains the final version of its files (not the original intermediate edits), and the dates are the date of the reorganisation. The old history is kept locally as `backup/original-history` and `backup/local-main-before-restructure`.
- The remote (GitHub) still has the previous history until it is replaced with a force push, which has not been done.

Use `git log --graph --oneline --all` to see it.

## 10. Rebuild it from nothing: checklist

1. Install Node 20+ and Chrome. Clone the repo, `npm install`.
2. Create the Atlas cluster, user and network rule (section 7).
3. Copy `.env.example` to `.env` and fill it in.
4. `npm run db:check`, `npm run seed`, `npm run dev`, then open http://localhost:3000.
5. `npm test` and `npm run test:e2e` should both be green.
6. Deploy to Render, set the environment variables, and check `/api/health`.

## 11. Ideas for later

- Real payments behind the wallet (a gateway such as Razorpay), with real charger meter data.
- Login rate limiting; a unique index so a user can hold only one bay even under simultaneous requests.
- Live updates over WebSockets or server-sent events instead of 5-second polling.
- Time-slot booking instead of "bay now".
- A real station feed instead of seeded sample data.
