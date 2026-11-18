import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const origin = process.env.APP_ORIGIN ?? 'https://localhost:8443';
const admin = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
if (!admin.email || !admin.password || !origin.startsWith('https://')) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD for an HTTPS deployment you own');
}
const headers = { Origin: origin, 'X-Lead-CSRF': '1' };
const profileId = 'SYNTH-001';
const run = randomBytes(5).toString('hex');

async function post(path: string, payload: object, cookie?: string) {
  const form = payload instanceof FormData;
  const response = await fetch(origin + '/api' + path, {
    method: 'POST',
    headers: { ...headers, ...(form ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: form ? payload : JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(path + ' failed with HTTP ' + response.status);
  return response;
}

async function login(credentials: object) {
  const response = await post('/auth/login', credentials);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Session cookie missing');
  return cookie;
}

const adminCookie = await login(admin);
const data = new FormData();
data.set('file', new Blob([await readFile(new URL('../fixtures/synthetic-profiles.csv', import.meta.url), 'utf8')],
  { type: 'text/csv' }), 'synthetic-profiles.csv');
await post('/admin/upload', data, adminCookie);

const accounts = [];
for (let i = 0; i < 50; i++) {
  const account = {
    email: 'load-' + run + '-' + i + '@example.invalid',
    password: randomBytes(24).toString('base64url'),
  };
  await post('/auth/register', account);
  const clientCookie = await login(account);
  const issued = await post('/admin/access-codes', { email: account.email, profileIds: [profileId] }, adminCookie);
  const { code } = await issued.json();
  await post('/access-codes/redeem', { code }, clientCookie);
  await post('/auth/logout', {}, clientCookie);
  accounts.push(account);
}
await post('/auth/logout', {}, adminCookie);
await writeFile(new URL('../.env.loadtest.json', import.meta.url), JSON.stringify({
  accounts, profileId, query: 'Northstar',
}), { mode: 0o600 });
console.log('Prepared 50 client accounts with an assigned synthetic profile');
