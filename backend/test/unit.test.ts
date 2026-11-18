import test from 'node:test';
import assert from 'node:assert/strict';
import { readProfiles } from '../csv.ts';
import { digest, emailAddress, LoginLimiter, token, validPassword } from '../security.ts';

test('reads quoted values and neutralizes spreadsheet formulas', () => {
  const input = Buffer.from('\ufeffid,name,region,sector,signal,data_note\r\nA1,"North, Inc",North,Industry,sale, =1+1\r\nA2,+Company,North,Industry,sale,@SUM\r\nA3,-Company,North,Industry,sale,plain');
  const { errors, profiles } = readProfiles(input);
  assert.deepEqual(errors, []);
  assert.equal(profiles[0].name, 'North, Inc');
  assert.equal(profiles[0].signal, 'sale');
  assert.equal(profiles[0].details.data_note, "'=1+1");
  assert.equal(profiles[1].name, "'+Company");
  assert.equal(profiles[1].details.data_note, "'@SUM");
  assert.equal(profiles[2].name, "'-Company");
});

test('reports bad schema, row length, missing fields, duplicates and malformed CSV', () => {
  assert.equal(readProfiles(Buffer.from('id,name\nA1,North')).errors[0].line, 1);
  const header = 'id,name,region,sector,signal\n';
  const result = readProfiles(Buffer.from(header + 'A1,North,West,Energy,sale\nA1,Duplicate,East,Energy,sale\nA2,,West,Energy,sale\nA3,Short'));
  assert.deepEqual(result.errors.map((row) => row.line), [3, 4, 5]);
  assert.equal(result.profiles.length, 1);
  assert.match(readProfiles(Buffer.from(header + 'A1,"oops')).errors[0].reason, /syntax/);
  assert.equal(readProfiles(Buffer.from([0xff])).errors.length, 1);
});

test('checks bcrypt byte limits and normalizes valid emails', () => {
  assert.equal(emailAddress('Test@EXAMPLE.invalid '), 'test@example.invalid');
  assert.equal(emailAddress('Test@EXAMPLE.invalid'), 'test@example.invalid');
  assert.equal(validPassword('é'.repeat(37)), false);
  assert.equal(validPassword('é'.repeat(36)), true);
  assert.equal(validPassword('short'), false);
  const raw = token();
  assert.match(raw, /^[\w-]{43}$/);
  assert.match(digest(raw), /^[a-f0-9]{64}$/);
});

test('counts five concurrent failures, rejects the sixth and isolates keys', async () => {
  const limiter = new LoginLimiter();
  const fail = async () => false;
  const success = async () => true;
  assert.deepEqual(await Promise.all(Array.from({ length: 6 }, () => limiter.verify('user', fail))),
    ['denied', 'denied', 'denied', 'denied', 'denied', 'limited']);
  assert.equal(await limiter.verify('user', success), 'limited');
  assert.equal(await limiter.verify('other', success), 'allowed');
});

test('only failures in the last minute count', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const limiter = new LoginLimiter();
  for (let i = 0; i < 5; i++) await limiter.verify('user', async () => false);
  t.mock.timers.tick(59_999);
  assert.equal(await limiter.verify('user', async () => true), 'limited');
  t.mock.timers.tick(1);
  assert.equal(await limiter.verify('user', async () => true), 'allowed');
});
