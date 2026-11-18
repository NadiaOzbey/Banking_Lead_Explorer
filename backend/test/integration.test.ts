import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect, migrate } from '../db.ts';
import { createApp } from '../app.ts';
import { createAdmin } from '../admin.ts';
import { token } from '../security.ts';

const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://lead_explorer:local-test-only@127.0.0.1:55432/lead_explorer_test');
if (url.pathname !== '/lead_explorer_test') throw new Error('Use a dedicated lead_explorer_test database');
const schema = 'test_' + randomUUID().replaceAll('-', '');
const management = connect(url.toString());
url.searchParams.set('options', '-c search_path=' + schema);
const pool = connect(url.toString());
const origin = 'https://localhost:8443';
const password = token();
const clientEmail = 'client@example.invalid';
let base: string;
let server: Server;

before(async () => {
  await management.sequelize.createSchema(schema);
  await migrate(pool);
  await migrate(pool);
  await createAdmin(pool, 'admin@example.invalid', password);
  server = createApp(pool, { origin }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.sequelize.close();
  try { await management.sequelize.dropSchema(schema, {}); }
  finally { await management.sequelize.close(); }
});

function get(path: string, cookie?: string) {
  return fetch(base + '/api' + path, { headers: cookie ? { cookie } : {} });
}

function post(path: string, body: Record<string, unknown> | FormData, cookie?: string, overrides: Record<string, string> = {}) {
  const multipart = body instanceof FormData;
  return fetch(base + '/api' + path, {
    method: 'POST',
    headers: {
      Origin: origin, 'X-Lead-CSRF': '1', ...(multipart ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { cookie } : {}), ...overrides,
    },
    body: multipart ? body : JSON.stringify(body),
  });
}

async function signIn(email: string) {
  const response = await post('/auth/login', { email, password });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie')!;
  assert.match(setCookie, /^__Host-lead_explorer=/);
  assert.match(setCookie, /; HttpOnly/i);
  assert.match(setCookie, /; Secure/i);
  assert.match(setCookie, /; SameSite=Lax/i);
  return setCookie.split(';')[0];
}

function file(contents: string | Uint8Array<ArrayBuffer>, name = 'profiles.csv', type = 'text/csv') {
  const data = new FormData();
  data.set('file', new Blob([contents], { type }), name);
  return data;
}

test('health, session, CSV, code lifecycle and per-profile access use real PostgreSQL', async () => {
  const health = await get('/health');
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.ok(health.headers.get('strict-transport-security'));
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await get('/profiles')).status, 401);
  assert.equal((await post('/auth/register', { email: clientEmail, password, role: 'admin' })).status, 400);
  assert.equal((await post('/auth/register', { email: clientEmail, password }, undefined, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await post('/auth/register', { email: clientEmail, password }, undefined, { 'X-Lead-CSRF': '' })).status, 403);
  assert.equal((await post('/auth/register', { email: clientEmail, password })).status, 201);
  assert.equal((await post('/auth/register', { email: 'other@example.invalid', password })).status, 201);
  await assert.rejects(createAdmin(pool, clientEmail, password), /cannot be promoted/);
  const admin = await signIn('admin@example.invalid');
  const client = await signIn(clientEmail);
  const other = await signIn('other@example.invalid');
  assert.equal((await (await get('/auth/me', client)).json()).role, 'client');

  const fixture = await readFile(new URL('../../fixtures/synthetic-profiles.csv', import.meta.url), 'utf8');
  assert.equal((await post('/admin/upload', file(fixture), client)).status, 403);
  assert.equal((await post('/admin/access-codes', { email: clientEmail, profileIds: ['SYNTH-001'] }, client)).status, 403);
  assert.equal((await post('/admin/upload', file(fixture, 'profiles.txt'), admin)).status, 400);
  assert.equal((await post('/admin/upload', file(new Uint8Array(5 * 1024 * 1024 + 1)), admin)).status, 413);
  const invalid = await post('/admin/upload', file(fixture + '\nBAD,,West,Energy,,1,2,3,4,sale,,,'), admin);
  assert.equal(invalid.status, 422);
  const details = await invalid.json();
  assert.ok(details.errors[0].line > 1);
  assert.equal((await (await get('/profiles', admin)).json()).total, 0);
  const uploaded = await post('/admin/upload', file(fixture), admin);
  assert.equal(uploaded.status, 201);
  assert.deepEqual(await uploaded.json(), { imported: 3 });
  assert.equal((await post('/admin/upload', file(fixture), admin)).status, 201);
  assert.equal((await (await get('/profiles', admin)).json()).total, 3);

  assert.equal((await post('/admin/access-codes', { email: clientEmail, profileIds: ['UNKNOWN'] }, admin)).status, 400);
  const issued = await post('/admin/access-codes', { email: clientEmail, profileIds: ['SYNTH-001'] }, admin);
  assert.equal(issued.status, 201);
  const { code } = await issued.json();
  assert.equal((await post('/access-codes/redeem', { code }, other)).status, 400);
  assert.equal((await post('/access-codes/redeem', { code }, client, { 'X-Lead-CSRF': '' })).status, 403);
  const redeemed = await Promise.all([
    post('/access-codes/redeem', { code }, client),
    post('/access-codes/redeem', { code }, client),
  ]);
  assert.deepEqual(redeemed.map((res) => res.status).sort(), [204, 400]);
  const list = await (await get('/profiles', client)).json();
  assert.deepEqual(list.items.map((row: { id: string }) => row.id), ['SYNTH-001']);
  assert.equal(list.unassignedCount, 2);
  assert.deepEqual(list.filters.region, ['North']);
  assert.doesNotMatch(JSON.stringify(list), /Blue Oak|Willow|South|SYNTH-002/);
  for (const query of ['q=Blue+Oak', 'region=South', 'sector=Energy', 'signal=sale', 'q=%27+OR+1%3D1', 'q=%25', 'q=_']) {
    const filtered = await (await get('/profiles?' + query, client)).json();
    assert.equal(filtered.total, 0);
    assert.equal(filtered.unassignedCount, 2);
  }
  assert.equal((await (await get('/profiles?page=2', client)).json()).items.length, 0);
  const assigned = await (await get('/profiles/SYNTH-001', client)).json();
  assert.equal(assigned.details.city, 'Hamburg');
  assert.equal(assigned.details.internal_reference, undefined);
  assert.equal((await get('/profiles/SYNTH-002', client)).status, 404);
  assert.equal((await get('/profiles/SYNTH-001', other)).status, 404);
  assert.equal((await get('/profiles/SYNTH-002', admin)).status, 200);

  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await post('/auth/login', { email: clientEmail, password: token() })).status, 401);
  }
  const limited = await post('/auth/login', { email: clientEmail, password });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await post('/auth/logout', {}, client)).status, 204);
  assert.equal((await get('/auth/me', client)).status, 401);
});
