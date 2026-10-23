# EV.Bolts

Find EV charging stations in Pune, hold a matching bay for 5 minutes, confirm it into a booking, and manage your vehicles and bookings.

**Live site:** https://ev-bolt-mern.onrender.com (free tier, so the first load after a quiet period can take about a minute).

Built with **Node.js, Express, MongoDB (Atlas)** and plain **HTML, CSS and JavaScript**.

**Explaining the project?** Read [notes_for_dev.md](notes_for_dev.md). It covers the architecture, the booking logic, authentication, a map from the old Java version, and likely questions.

**Want the story of how it was built?** Read [build_log.md](build_log.md): the starting point, decisions, order of work, every problem we hit and its fix, testing, deployment and a rebuild checklist.

## Features

- Sign up / sign in with a 5-minute access token (httpOnly cookie) and a 30-day refresh token kept in the database; the server refreshes an expired access token by itself
- Register vehicles and their connector types
- Stations sorted by distance (MongoDB geospatial query), with live bay status
- Hold a bay for 5 minutes, then confirm or release it. Two people can never get the same bay.
- **Wallet** (demo top-up) that pays a per-booking advance; unused advance is refunded when the session ends
- Start and finish a charging session, bills settled on the energy used; cancel for a full refund
- Edit or remove your vehicles; edit your profile, change your password, or delete your account
- Responsive: sidebar on desktop, a menu sheet on phones

## Quick start

Requires **Node.js 20+** and a free **MongoDB Atlas** cluster.

```bash
npm install
cp .env.example .env     # then fill in the values below
npm run db:check         # verifies the MongoDB connection
npm run seed             # adds 8 Pune stations and 40 bays
npm run dev              # http://localhost:3000
```

### Getting a MongoDB connection string

1. Create a free **M0** cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. **Database Access** → add a user and password (avoid `@ : / ?` in the password).
3. **Network Access** → add `0.0.0.0/0` (needed for Render; restrict it for production).
4. **Connect → Drivers** → copy the `mongodb+srv://…` string into `MONGODB_URI` in `.env`.

### Environment variables

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `DB_NAME` | Database name (default `ev_bolts`) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Long random strings. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `PORT` | Server port (default 3000) |
| `NODE_ENV` | Set to `production` when deployed (enables secure cookies) |
| `DNS_SERVERS` | Optional. Set to `8.8.8.8,1.1.1.1` if you get `querySrv ECONNREFUSED` locally |

Never commit `.env`. It is git-ignored.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-restart |
| `npm start` | Start (production) |
| `npm run db:check` | Test the MongoDB connection |
| `npm run seed` | Seed stations and bays (`-- --reset` wipes and re-seeds them) |
| `npm test` | API tests, 53 of them (real MongoDB, database `ev_bolts_test`) |
| `npm run test:e2e` | Browser tests with Playwright and Chrome, 18 of them (database `ev_bolts_e2e`) |

Run the browser tests against a deployed site with `BASE_URL=https://your-app.onrender.com npm run test:e2e`.

Bays created before pricing existed get a default speed and price automatically when the server starts.

## Deploy to Render

1. Push this repo to GitHub.
2. In Render: **New → Web Service** → connect the repo.
3. Build command `npm ci`, start command `npm start`.
4. Add the environment variables above (`NODE_ENV=production`).
5. Open `/api/health`. It should return `{"ok":true,"db":"connected"}`.
6. Seed the database once: run `npm run seed` locally with `MONGODB_URI` pointing at the same cluster.

## Project layout

```
server/    Express app, routes, models, booking service, scripts
shared/    validation rules used by both server and browser
public/    pages, CSS, browser JavaScript
tests/     api/ (node:test) and e2e/ (Playwright)
```

## Credits

Login background (credited in a small info button, bottom-left, on the login and signup pages): "Car2Go Charging Station Stuttgart 2013 01" by Julian Herzog, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0), via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Car2Go_Charging_Station_Stuttgart_2013_01.jpg).
