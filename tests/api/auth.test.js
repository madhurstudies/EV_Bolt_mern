import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, setupDb, teardownDb, PASSWORD } from '../helpers.js';
import User from '../../server/models/User.js';

before(() => setupDb());
after(() => teardownDb());

const body = (over = {}) => ({ name: 'Alex Johnson', username: 'alex_j', email: 'alex@example.com', password: PASSWORD, ...over });
const setCookies = (res) => res.headers['set-cookie'] ?? [];
const cookieNames = (res) => setCookies(res).map((c) => c.split('=')[0]);
// "name=value" for one Set-Cookie
const pair = (res, name) => setCookies(res).find((c) => c.startsWith(`${name}=`))?.split(';')[0];
const value = (res, name) => pair(res, name)?.slice(name.length + 1);
const claims = (token) => jwt.decode(token);

const login = (username = 'alex_j') => request(app).post('/api/auth/login').send({ username, password: PASSWORD });
const dbUser = (username = 'alex_j') => User.findOne({ username });
// an access token for the same user and session that is already expired
const expiredAccess = (token) => {
  const c = claims(token);
  return jwt.sign({ sub: c.sub, username: c.username, sid: c.sid }, process.env.JWT_ACCESS_SECRET, { expiresIn: -60 });
};
const me = (cookie) => request(app).get('/api/users/me').set('Cookie', cookie);

test('signup: access token (5 min) in a cookie, refresh token (30 days) only in the database', async () => {
  const res = await request(app).post('/api/auth/signup').send(body());
  assert.equal(res.status, 201);
  assert.deepEqual(cookieNames(res).filter((n) => n !== 'refresh_token'), ['access_token']); // the only cookie set is the access token
  assert.ok(setCookies(res).find((c) => c.startsWith('access_token=')).match(/HttpOnly/i));

  const access = claims(value(res, 'access_token'));
  assert.equal(access.exp - access.iat, 5 * 60);

  const user = await dbUser();
  assert.ok(user.refreshToken, 'refresh token is stored on the user');
  const refresh = claims(user.refreshToken);
  assert.equal(refresh.exp - refresh.iat, 30 * 24 * 60 * 60);
  assert.equal(refresh.jti, access.sid); // the access token is tied to this refresh token
  assert.ok(!JSON.stringify(res.headers).includes(user.refreshToken), 'refresh token never reaches the browser');
});

test('duplicate username (any case) is 409', async () => {
  const res = await request(app).post('/api/auth/signup').send(body({ username: 'ALEX_J' }));
  assert.equal(res.status, 409);
});

test('weak password and bad username are 400 with field errors', async () => {
  const res = await request(app).post('/api/auth/signup').send(body({ username: '1bad', password: 'short' }));
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.username);
  assert.ok(res.body.errors.password);
});

test('password is stored hashed, never in plain text', async () => {
  const u = await dbUser();
  assert.notEqual(u.passwordHash, PASSWORD);
  assert.match(u.passwordHash, /^\$2[aby]\$/);
});

test('login: wrong password and unknown user both give the same 401 and set no cookie', async () => {
  const a = await request(app).post('/api/auth/login').send({ username: 'alex_j', password: 'nope' });
  const b = await request(app).post('/api/auth/login').send({ username: 'ghost', password: PASSWORD });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.message, b.body.message);
  assert.equal(pair(a, 'access_token'), undefined);
});

test('login stores a fresh refresh token in the database and sets the access cookie', async () => {
  const before = (await dbUser()).refreshToken;
  const res = await login();
  assert.equal(res.status, 200);
  const after = (await dbUser()).refreshToken;
  assert.notEqual(after, before);
  assert.equal(claims(value(res, 'access_token')).sid, claims(after).jti);
});

test('/me without a cookie is 401; with a login it returns the profile', async () => {
  assert.equal((await request(app).get('/api/users/me')).status, 401);
  const res = await login();
  const profile = await me(pair(res, 'access_token'));
  assert.equal(profile.status, 200);
  assert.equal(profile.body.name, 'Alex Johnson');
  assert.equal(profile.body.passwordHash, undefined);
  assert.equal(profile.body.refreshToken, undefined);
});

test('expired access token + valid refresh token in the DB: the request succeeds (200) with a new access cookie', async () => {
  const res = await login();
  const old = value(res, 'access_token');

  const r = await me(`access_token=${expiredAccess(old)}`);
  assert.equal(r.status, 200); // no 401, no client retry needed
  assert.equal(r.body.username, 'alex_j');

  const fresh = value(r, 'access_token');
  assert.ok(fresh, 'a new access token was issued');
  const c = claims(fresh);
  assert.equal(c.exp - c.iat, 5 * 60);
  assert.equal(c.sid, claims(old).sid); // same login session
  assert.equal((await me(`access_token=${fresh}`)).status, 200);
});

test('expired access token + expired refresh token: 401, cookie cleared, stored token removed', async () => {
  const res = await login();
  const old = value(res, 'access_token');
  const c = claims(old);
  const deadRefresh = jwt.sign({ sub: c.sub }, process.env.JWT_REFRESH_SECRET, { expiresIn: -60, jwtid: c.sid });
  await User.updateOne({ username: 'alex_j' }, { $set: { refreshToken: deadRefresh } });

  const r = await me(`access_token=${expiredAccess(old)}`);
  assert.equal(r.status, 401);
  assert.match(setCookies(r).find((x) => x.startsWith('access_token=')), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await dbUser()).refreshToken, null);
});

test('one device at a time: a newer login ends the older session once its access token expires', async () => {
  const deviceA = await login();
  const a = value(deviceA, 'access_token');
  const deviceB = await login(); // replaces the stored refresh token

  // A's access token is still valid for its 5 minutes...
  assert.equal((await me(`access_token=${a}`)).status, 200);
  // ...but once it expires, A cannot refresh any more
  assert.equal((await me(`access_token=${expiredAccess(a)}`)).status, 401);
  // B is unaffected, even after its own token expires
  assert.equal((await me(`access_token=${expiredAccess(value(deviceB, 'access_token'))}`)).status, 200);
});

test('logout clears the cookie and the refresh token in the database', async () => {
  const res = await login();
  const token = value(res, 'access_token');
  const out = await request(app).post('/api/auth/logout').set('Cookie', `access_token=${token}`);
  assert.equal(out.status, 204);
  assert.match(setCookies(out).find((x) => x.startsWith('access_token=')), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await dbUser()).refreshToken, null);

  // nothing left to refresh with: the copied cookie dies as soon as it expires
  assert.equal((await me(`access_token=${expiredAccess(token)}`)).status, 401);
});

test('logout still works after the access token has expired', async () => {
  const res = await login();
  const out = await request(app).post('/api/auth/logout').set('Cookie', `access_token=${expiredAccess(value(res, 'access_token'))}`);
  assert.equal(out.status, 204);
  assert.equal((await dbUser()).refreshToken, null);
});

test("logging out on an old device does not end a newer login", async () => {
  const deviceA = await login();
  await login(); // device B now owns the stored refresh token
  const stored = (await dbUser()).refreshToken;
  const out = await request(app).post('/api/auth/logout').set('Cookie', `access_token=${value(deviceA, 'access_token')}`);
  assert.equal(out.status, 204);
  assert.equal((await dbUser()).refreshToken, stored);
});

test('logout with no cookie is a harmless 204', async () => {
  assert.equal((await request(app).post('/api/auth/logout')).status, 204);
});

test('a tampered or wrongly-signed access token is rejected, and there is no /refresh endpoint any more', async () => {
  assert.equal((await me('access_token=abc.def.ghi')).status, 401);
  const c = claims(value(await login(), 'access_token'));
  const forged = jwt.sign({ sub: c.sub, username: c.username, sid: c.sid }, 'not-the-real-secret', { expiresIn: -60 });
  assert.equal((await me(`access_token=${forged}`)).status, 401);
  assert.equal((await request(app).post('/api/auth/refresh')).status, 404);
});
